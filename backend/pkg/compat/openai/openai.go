// openai package adds an OpenAI API compatibility layer
// lifting a lot of code from the Ollama implementation
// https://github.com/ollama/ollama/blob/main/openai/openai.go
package openai

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase/apis"
	oai "github.com/sashabaranov/go-openai"
)

var (
	headerData = []byte("data: ")
	newLine    = []byte("\n\n")
)

// Metadata augments the OpenAI request with additional metadata
// that is specific to the Cognos platform
type Metadata struct {
	Cognos struct {
		ConversationID string `json:"conversation_id,omitempty"`
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
	logger *slog.Logger,
	openaiClient *oai.Client,
	messageRepo chat.MessageRepo,
	keyPairRepo auth.KeyPairRepo,
) echo.HandlerFunc {
	return func(c echo.Context) error {
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

		// Forward the request to OpenAI
		stream, err := openaiClient.CreateChatCompletionStream(
			c.Request().Context(),
			req.ChatCompletionRequest,
		)
		if err != nil {
			return apis.NewApiError(
				http.StatusInternalServerError,
				"Failed to create chat completion stream",
				err,
			)
		}
		defer stream.Close()

		plainTextResponseMessage := ""

		// Set the headers for the response
		c.Response().Header().Set(echo.HeaderContentType, "text/event-stream")
		c.Response().Header().Set(echo.HeaderConnection, "keep-alive")
		c.Response().Header().Set(echo.HeaderCacheControl, "no-cache")

		respWriter := c.Response().Unwrap()

		// Gather the response chunks
		for {
			chunk, err := stream.Recv()
			if errors.Is(err, io.EOF) {
				// stream has finished
				_, err = respWriter.Write([]byte("data: [DONE]\n\n"))
				if err != nil {
					logger.Error("Failed to write error to response", "err", err)
					return err
				}
				c.Response().Flush()
				break
			}

			if err != nil {
				// stream has errored
				logger.Error("Failed to read from stream", "err", err)
				return err
			}

			// Construct our plaintext response that will be encrypted and saved
			plainTextResponseMessage += chunk.Choices[0].Delta.Content

			// Re-marshal the response to send to the client
			marshalledChunk, err := json.Marshal(chunk)
			if err != nil {
				// handle error
				logger.Error("Failed to marshal chunk", "err", err)
				return err
			}

			_, err = respWriter.Write(
				append(append(headerData, marshalledChunk...), newLine...),
			)
			if err != nil {
				logger.Error("Failed to write to response", "err", err)
				return err
			}

			c.Response().Flush()
		}

		// Encrypt and persist the response
		logger.Info(plainTextResponseMessage)

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
