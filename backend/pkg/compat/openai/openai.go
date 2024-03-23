// openai package adds an OpenAI API compatibility layer
// lifting a lot of code from the Ollama implementation
// https://github.com/ollama/ollama/blob/main/openai/openai.go
package openai

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/proxy"
	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase/apis"
	oai "github.com/sashabaranov/go-openai"
)

// Metadata augments the OpenAI request with additional metadata
// that is specific to the Cognos platform
type Metadata struct {
	Cognos struct {
		ConversationID string `json:"conversation_id,omitempty"`
		AgentID        string `json:"agent_id,omitempty"`
	} `json:"cognos,omitempty"`
}

type ChatCompletionRequestWithMetadata struct {
	oai.ChatCompletionRequest
	Metadata Metadata `json:"metadata,omitempty"`
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
	openaiClient *oai.Client,
	messageRepo chat.MessageRepo,
	keyPairRepo auth.KeyPairRepo,
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

		// Validate the incoming request
		if req.Metadata.Cognos.ConversationID == "" {
			return apis.NewBadRequestError("Conversation ID is required", nil)
		}
		if req.Metadata.Cognos.AgentID == "" {
			return apis.NewBadRequestError("Agent ID is required", nil)
		}
		// Extract the upstream based on the model
		upstream, err := proxy.ParseModelName(config, req.ChatCompletionRequest.Model)
		if err != nil {
			return apis.NewBadRequestError("Invalid model name", err)
		}
		// Check the user has permission to write to this conversation

		// Lookup the agent
		// Check user has permission to access the agent

		// -------------------------------------------------------
		// 2. Process the request
		// -------------------------------------------------------
		// Get the public key of the conversation
		receiverPublicKey, err := keyPairRepo.ConversationPublicKey(
			req.Metadata.Cognos.ConversationID,
		)
		if errors.Is(err, auth.ErrNoKeyPair) {
			return apis.NewNotFoundError("Conversation public key not found", nil)
		}
		if err != nil {
			return apis.NewApiError(
				http.StatusInternalServerError,
				"Failed to get conversation public key",
				err,
			)
		}

		// Encrypt and persist the incoming message
		messages := req.Messages
		plainTextRequestMessage := messages[len(messages)-1].Content // Use the last message as there could be system and previous system & user messages

		requestMessage := chat.PlainTextMessage{
			OwnerID:        owner.ID,
			ConversationID: req.Metadata.Cognos.ConversationID,
			Content:        plainTextRequestMessage,
		}

		err = messageRepo.EncryptAndPersistMessage(receiverPublicKey, &requestMessage)
		if err != nil {
			logger.Error("Failed to save request message", "err", err)
			return apis.NewApiError(
				http.StatusInternalServerError,
				"Failed to save request message",
				err,
			)
		}

		// -------------------------------------------------------
		// 3. Use the selected model and agent to generate the response
		// -------------------------------------------------------
		plainTextResponseMessage, err := upstream.ChatCompletion(
			c,
			req.ChatCompletionRequest,
		)
		if err != nil {
			if errors.Is(err, &apis.ApiError{}) {
				return err
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
		responseMessage := chat.PlainTextMessage{
			OwnerID:        owner.ID,
			ConversationID: req.Metadata.Cognos.ConversationID,
			Content:        plainTextResponseMessage,
		}
		err = messageRepo.EncryptAndPersistMessage(receiverPublicKey, &responseMessage)
		if err != nil {
			logger.Error("Failed to save response message", "err", err)
			return apis.NewApiError(
				http.StatusInternalServerError,
				"Failed to save response message",
				err,
			)
		}

		return nil
	}
}
