package proxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"

	"github.com/labstack/echo/v5"
	"github.com/sashabaranov/go-openai"
)

var (
	headerData = []byte("data: ")
	newLine    = []byte("\n\n")
)

type OpenAI struct {
	client *openai.Client
	logger *slog.Logger
}

func (o *OpenAI) LookupModel(
	internalModel string,
) (string, error) {
	// Map our internal model names to the upstream model names
	switch internalModel {
	case "gpt-3.5-turbo":
		return openai.GPT3Dot5Turbo, nil
	default:
		return "", fmt.Errorf("invalid model name: %s", internalModel)
	}
}

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
			return plainTextResponseMessage, err
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
			return plainTextResponseMessage, err
		}

		// Construct our plaintext response that will be encrypted and saved
		plainTextResponseMessage = resp.Choices[0].Message.Content
	}

	return plainTextResponseMessage, nil
}

func NewOpenAI(
	client *openai.Client,
	logger *slog.Logger,
) (*OpenAI, error) {
	return &OpenAI{
		logger: logger,
		client: client,
	}, nil
}
