// openai package adds an OpenAI API compatibility layer
// lifting a lot of code from the Ollama implementation
// https://github.com/ollama/ollama/blob/main/openai/openai.go
package openai

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/aiagent"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/proxy"
	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/models"
	oai "github.com/sashabaranov/go-openai"
)

const (
	modelDelimiter = ":" // Delimiter used to separate the provider and model name
)

// RequestMetadata augments the OpenAI request with additional metadata
// that is specific to the Cognos platform.
// Model ID is in the format: `provider:model` e.g. `openai:gpt-3.5-turbo` and
// is present in the `model` field of the request.
type RequestMetadata struct {
	Cognos struct {
		ParentMessageID string `json:"parent_message_id,omitempty"`
		ConversationID  string `json:"conversation_id,omitempty"`
		AgentID         string `json:"agent_id,omitempty"`
		RequestID       string `json:"request_id,omitempty"` // Arbitrary ID for frontend to track requests
	} `json:"cognos,omitempty"`
}

type CognosResponseMetadata struct {
	RequestID       string `json:"request_id,omitempty"` // Sent back to the frontend to track requests
	ParentMessageID string `json:"parent_message_id,omitempty"`
	// ID of the message record that was created for the request
	MessageRecordID string `json:"message_record_id,omitempty"`
	// ID of the message record that was created for the response
	ResponseRecordID string `json:"response_record_id,omitempty"`
	// When the messages will expire
	ExpiresAt string `json:"expires_at,omitempty"`
}

type ResponseMetadata struct {
	Cognos CognosResponseMetadata `json:"cognos,omitempty"`
}

type ChatCompletionRequestWithMetadata struct {
	oai.ChatCompletionRequest
	Metadata RequestMetadata `json:"metadata,omitempty"`
}

type ChatCompletionResponseWithMetadata struct {
	oai.ChatCompletionResponse
	Metadata ResponseMetadata `json:"metadata,omitempty"`
}

func NewError(code int, message string) oai.ErrorResponse {
	var errorType string
	switch code {
	case http.StatusBadRequest:
		errorType = "invalid_request_error"
	case http.StatusNotFound:
		errorType = "not_found_error"
	default:
		errorType = "api_error"
	}

	return oai.ErrorResponse{Error: &oai.APIError{Type: errorType, Message: message}}
}

func EchoHandler(
	config *config.APIConfig,
	logger *slog.Logger,
	upstreamRepo proxy.UpstreamRepo,
	messageRepo chat.MessageRepo,
	keyPairRepo auth.KeyPairRepo,
	agentRepo aiagent.AIAgentRepo,
	conversationRepo chat.ConversationRepo,
) echo.HandlerFunc {
	return func(c echo.Context) error {
		// -------------------------------------------------------
		// 1. Get all the information we need from the request
		// -------------------------------------------------------
		owner := auth.ExtractUser(c)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		// Parse the incoming request
		var req ChatCompletionRequestWithMetadata
		if err := c.Bind(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		// Add the user ID to the request. It's nothing personal but is used to help
		// identify abuse of our AI providers
		req.User = owner.ID

		// Validate the incoming request
		if req.Metadata.Cognos.AgentID == "" {
			return apis.NewBadRequestError("Agent ID is required", nil)
		}
		// Extract the upstream based on the model
		modelParts := strings.Split(req.Model, modelDelimiter)
		if len(modelParts) != 2 {
			return apis.NewBadRequestError("Invalid model name", nil)
		}
		provider := modelParts[0]
		model := modelParts[1]

		upstream, err := upstreamRepo.Provider(provider)
		if err != nil {
			return apis.NewBadRequestError("Invalid provider", err)
		}
		req.Model, err = upstream.LookupModel(model)
		if err != nil {
			return apis.NewBadRequestError("Invalid model name", err)
		}
		// Check the user has permission to write to this conversation

		// Lookup the agent
		agent, err := agentRepo.LookupPrompt(req.Metadata.Cognos.AgentID)
		if err != nil {
			return apis.NewBadRequestError("Invalid agent ID", err)
		}
		// Check user has permission to access the agent

		// -------------------------------------------------------
		// 2. Process the request
		// -------------------------------------------------------

		// If there is no conversation ID then we don't encrypt and persist the message.
		// This could be useful if:
		// - The user is using their own frontend which doesn't support conversation IDs
		// - The message is temporary and shouldn't be persisted
		// - The message is used to generate conversation titles
		shouldPersist := req.Metadata.Cognos.ConversationID != ""

		var conversation chat.Conversation
		if shouldPersist {
			conversation, err = conversationRepo.ByID(
				req.Metadata.Cognos.ConversationID,
			)
			if err != nil {
				return apis.NewNotFoundError(
					"Conversation not found or unable to load",
					err,
				)
			}
		}

		var messageRecord, responseRecord *models.Record

		// Add the agent prompt system message to the conversation
		req.Messages = AddSystemMessage(req.Messages, agent)

		// Encrypt and persist the incoming message
		plainTextRequestMessage := req.Messages[len(req.Messages)-1].Content // Use the last message as there could be system and previous system & user messages

		requestMessage := chat.MessageRecordData{
			OwnerID: owner.ID,
			Content: plainTextRequestMessage,
		}

		if shouldPersist {
			err, messageRecord = messageRepo.EncryptAndPersistMessage(
				conversation,
				req.Metadata.Cognos.ParentMessageID,
				requestMessage,
			)
			if err != nil {
				logger.Error("Failed to save request message", "err", err)
				return apis.NewApiError(
					http.StatusInternalServerError,
					"Failed to save request message",
					err,
				)
			}
		}

		// -------------------------------------------------------
		// 3. Use the selected model and agent to generate the response
		// -------------------------------------------------------
		resp, plainTextResponseMessage, err := upstream.ChatCompletion(
			c,
			req.ChatCompletionRequest,
		)
		if err != nil && messageRecord != nil {
			logger.Error("Failed to process request", "err", err)
			// Try to clean up the originally saved message
			if err := messageRepo.DeleteMessage(messageRecord.Id); err != nil {
				logger.Error("Failed to clean up message record", "err", err)
			}
			return apis.NewApiError(
				http.StatusInternalServerError,
				"Failed to process request",
				err,
			)
		}

		// -------------------------------------------------------
		// 4. Encrypt and persist the response
		// -------------------------------------------------------
		responseMessage := chat.MessageRecordData{
			Content: plainTextResponseMessage,
			AgentID: req.Metadata.Cognos.AgentID,
			ModelID: strings.Join(
				modelParts,
				modelDelimiter,
			), // rejoin the model parts to store the full model name
		}

		if shouldPersist {
			err, responseRecord = messageRepo.EncryptAndPersistMessage(
				conversation,
				messageRecord.Id,
				responseMessage,
			)
			if err != nil {
				logger.Error("Failed to save response message", "err", err)
				return apis.NewApiError(
					http.StatusInternalServerError,
					"Failed to save response message",
					err,
				)
			}
		}

		var extendedResponse ChatCompletionResponseWithMetadata
		extendedResponse.ChatCompletionResponse = resp
		extendedResponse.Metadata.Cognos = CognosResponseMetadata{
			RequestID: req.Metadata.Cognos.RequestID,
		}

		if conversation.ExpiryDuration > 0 {
			extendedResponse.Metadata.Cognos.ExpiresAt = time.Now().
				UTC().
				Add(conversation.ExpiryDuration).
				Format(time.RFC3339)
		}

		if messageRecord != nil {
			extendedResponse.Metadata.Cognos.ParentMessageID = messageRecord.Id
			extendedResponse.Metadata.Cognos.MessageRecordID = messageRecord.Id
		}

		if responseRecord != nil {
			extendedResponse.Metadata.Cognos.ResponseRecordID = responseRecord.Id
		}

		return c.JSON(http.StatusOK, extendedResponse)
	}
}

func AddSystemMessage(
	messages []oai.ChatCompletionMessage,
	agent aiagent.Prompt,
) []oai.ChatCompletionMessage {
	if len(messages) == 0 {
		return messages
	}
	// We should only have one system message per request to avoid confusing the AI
	var newMessages []oai.ChatCompletionMessage
	for _, message := range messages {
		if message.Role != "system" {
			newMessages = append(newMessages, message)
		}
	}

	var systemMessage oai.ChatCompletionMessage
	// If the first message is a system message, prioritize it as it could
	// be the users choice from the frontend
	if messages[0].Role == "system" {
		systemMessage = messages[0]
	} else {
		// set our system message
		systemMessage = oai.ChatCompletionMessage{
			Role:    "system",
			Content: agent.SystemMessage,
		}
		// TODO(ewan): we may also need to trim the message by the number of tokens in the prompt to fit it within the model context window
	}

	return append(
		[]oai.ChatCompletionMessage{systemMessage},
		append(agent.Examples, newMessages...)...,
	)
}
