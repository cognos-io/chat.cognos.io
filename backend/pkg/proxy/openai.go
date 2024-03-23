package proxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/sashabaranov/go-openai"
)

type OpenAI struct {
	client *openai.Client
	logger *slog.Logger
}

var (
	headerData = []byte("data: ")
	newLine    = []byte("\n\n")
)

func (o *OpenAI) ChatCompletion(
	c echo.Context,
	req openai.ChatCompletionRequest,
) (plainTextResponseMessage string, err error) {
	if req.Stream {
		// Forward the request to OpenAI
		stream, err := o.client.CreateChatCompletionStream(
			c.Request().Context(),
			req,
		)
		if err != nil {
			return plainTextResponseMessage, apis.NewApiError(
				http.StatusInternalServerError,
				"Failed to create chat completion stream",
				err,
			)
		}
		defer stream.Close()

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
					o.logger.Error("Failed to write error to response", "err", err)
					return plainTextResponseMessage, err
				}
				c.Response().Flush()
				break
			}

			if err != nil {
				// stream has errored
				o.logger.Error("Failed to read from stream", "err", err)
				return plainTextResponseMessage, err
			}

			// Construct our plaintext response that will be encrypted and saved
			plainTextResponseMessage += chunk.Choices[0].Delta.Content

			// Re-marshal the response to send to the client
			marshalledChunk, err := json.Marshal(chunk)
			if err != nil {
				// handle error
				o.logger.Error("Failed to marshal chunk", "err", err)
				return plainTextResponseMessage, err
			}

			_, err = respWriter.Write(
				append(append(headerData, marshalledChunk...), newLine...),
			)
			if err != nil {
				o.logger.Error("Failed to write to response", "err", err)
				return plainTextResponseMessage, err
			}

			c.Response().Flush()
		}
	} else {
		// Forward the request to OpenAI
		resp, err := o.client.CreateChatCompletion(
			c.Request().Context(),
			req,
		)
		if err != nil {
			return plainTextResponseMessage, apis.NewApiError(
				http.StatusInternalServerError,
				"Failed to create chat completion",
				err,
			)
		}

		// Construct our plaintext response that will be encrypted and saved
		plainTextResponseMessage = resp.Choices[0].Message.Content
	}

	return plainTextResponseMessage, nil
}

func NewOpenAI(config *config.APIConfig, model string) (*OpenAI, error) {
	client := openai.NewClient(config.OpenAIAPIKey)

	var openAIModel string

	switch model {
	case "gpt-3.5-turbo":
		openAIModel = openai.GPT3Dot5Turbo
	default:
		return nil, fmt.Errorf("invalid model name: %s", model)
	}

	fmt.Println(
		openAIModel,
	) // use the variable to avoid the "declared and not used" error

	return &OpenAI{
		client: client,
	}, nil
}
