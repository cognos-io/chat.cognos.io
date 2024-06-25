package proxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"

	"github.com/labstack/echo/v5"
	"github.com/sashabaranov/go-openai"
)

var (
	HeaderData = []byte("data: ")
	NewLine    = []byte("\n\n")
)

var openAIModelMapping = map[string]string{
	"gpt-3.5-turbo": openai.GPT3Dot5Turbo,
	"gpt-4o":        openai.GPT4o,
}

// compile time type checking
var _ Upstream = (*OpenAI)(nil)

type OpenAI struct {
	client *openai.Client
	logger *slog.Logger
}

func (o *OpenAI) LookupModel(
	internalModel string,
) (string, error) {
	return OpenAIModelMapper(internalModel)
}

func (o *OpenAI) ChatCompletion(
	c echo.Context,
	req openai.ChatCompletionRequest,
) (response openai.ChatCompletionResponse, plainTextResponseMessage string, err error) {
	if req.Stream {
		err = fmt.Errorf("streaming is enabled for this request")
		return
	}
	return ForwardOpenAIResponse(c, req, o.logger, o.client)
}

func (o *OpenAI) ChatCompletionStream(
	c echo.Context,
	req openai.ChatCompletionRequest,
) (response openai.ChatCompletionStreamResponse, plainTextResponseMessage string, err error) {
	if !req.Stream {
		err = fmt.Errorf("streaming is not enabled for this request")
		return
	}
	return StreamOpenAIResponse(c, req, o.logger, o.client)
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

func OpenAIModelMapper(model string) (string, error) {
	if mappedModel, ok := openAIModelMapping[model]; ok {
		return mappedModel, nil
	}
	return "", fmt.Errorf("invalid model name: %s", model)
}

func StreamOpenAIResponse(
	c echo.Context,
	req openai.ChatCompletionRequest,
	logger *slog.Logger,
	client *openai.Client,
) (response openai.ChatCompletionStreamResponse, plainTextResponseMessage string, err error) {
	emptyResponse := openai.ChatCompletionStreamResponse{}
	// Forward the request to OpenAI
	stream, err := client.CreateChatCompletionStream(
		c.Request().Context(),
		req,
	)
	if err != nil {
		return emptyResponse, plainTextResponseMessage, err
	}
	defer stream.Close()

	// Small optimization for building the full message
	// https://100go.co/?h=strings#under-optimized-strings-concatenation-39
	sb := strings.Builder{}

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
			// We avoid sending a DONE message here because we also need to add the metadata message
			break
		}

		if err != nil {
			// stream has errored
			logger.Error("Failed to read from stream", "err", err)
			return emptyResponse, plainTextResponseMessage, err
		}

		// Construct our plaintext response that will be encrypted and saved
		sb.WriteString(chunk.Choices[0].Delta.Content)

		// Re-marshal the response to send to the client
		marshalledChunk, err := json.Marshal(chunk)
		if err != nil {
			// handle error
			logger.Error("Failed to marshal chunk", "err", err)
			return emptyResponse, plainTextResponseMessage, err
		}

		_, err = respWriter.Write(
			append(append(HeaderData, marshalledChunk...), NewLine...),
		)
		if err != nil {
			logger.Error("Failed to write to response", "err", err)
			return emptyResponse, plainTextResponseMessage, err
		}

		c.Response().Flush()
	}

	plainTextResponseMessage = sb.String()

	return
}

func ForwardOpenAIResponse(
	c echo.Context,
	req openai.ChatCompletionRequest,
	logger *slog.Logger,
	client *openai.Client,
) (resp openai.ChatCompletionResponse, plainTextResponseMessage string, err error) {
	emptyResponse := openai.ChatCompletionResponse{}

	// Forward the request to OpenAI
	resp, err = client.CreateChatCompletion(
		c.Request().Context(),
		req,
	)
	if err != nil {
		return emptyResponse, plainTextResponseMessage, err
	}

	// Construct our plaintext response that will be encrypted and saved
	plainTextResponseMessage = resp.Choices[0].Message.Content

	return
}
