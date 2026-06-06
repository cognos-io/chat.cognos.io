package proxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/sashabaranov/go-openai"
)

var (
	headerData = []byte("data: ")
	newLine    = []byte("\n\n")
)

var openAIModelMapping = map[string]string{
	"gpt-3.5-turbo": openai.GPT3Dot5Turbo,
	"gpt-4o":        openai.GPT4o,
}

// compile time type checking
var _ Upstream = (*OpenAI)(nil)

type OpenAI struct {
	client              *openai.Client
	logger              *slog.Logger
	supportsNoRetention bool
}

func (o *OpenAI) LookupModel(
	internalModel string,
) (string, error) {
	return OpenAIModelMapper(internalModel)
}

func (o *OpenAI) EnsureNoRetention() error {
	if !o.supportsNoRetention {
		return ErrNoRetentionUnsupported
	}

	return nil
}

func (o *OpenAI) ChatCompletion(
	e *core.RequestEvent,
	req openai.ChatCompletionRequest,
) (response openai.ChatCompletionResponse, plainTextResponseMessage string, err error) {
	if req.Stream {
		return StreamOpenAIResponse(e, req, o.logger, o.client)
	}
	return ForwardOpenAIResponse(e, req, o.logger, o.client)
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

func NewInfomaniak(
	client *openai.Client,
	logger *slog.Logger,
) (*OpenAI, error) {
	return &OpenAI{
		logger:              logger,
		client:              client,
		supportsNoRetention: true,
	}, nil
}

func OpenAIModelMapper(model string) (string, error) {
	if mappedModel, ok := openAIModelMapping[model]; ok {
		return mappedModel, nil
	}
	return "", fmt.Errorf("invalid model name: %s", model)
}

func StreamOpenAIResponse(
	e *core.RequestEvent,
	req openai.ChatCompletionRequest,
	logger *slog.Logger,
	client *openai.Client,
) (response openai.ChatCompletionResponse, plainTextResponseMessage string, err error) {
	emptyResponse := openai.ChatCompletionResponse{}
	stream, err := client.CreateChatCompletionStream(
		e.Request.Context(),
		req,
	)
	if err != nil {
		return emptyResponse, plainTextResponseMessage, err
	}
	defer stream.Close()

	sb := strings.Builder{}

	e.Response.Header().Set("Content-Type", "text/event-stream")
	e.Response.Header().Set("Connection", "keep-alive")
	e.Response.Header().Set("Cache-Control", "no-cache")

	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			_, err = e.Response.Write([]byte("data: [DONE]\n\n"))
			if err != nil {
				logger.Error("Failed to write error to response", "err", err)
				return emptyResponse, plainTextResponseMessage, err
			}
			if err := e.Flush(); err != nil && !errors.Is(err, http.ErrNotSupported) {
				return emptyResponse, plainTextResponseMessage, err
			}
			break
		}

		if err != nil {
			logger.Error("Failed to read from stream", "err", err)
			return emptyResponse, plainTextResponseMessage, err
		}

		sb.WriteString(chunk.Choices[0].Delta.Content)

		marshalledChunk, err := json.Marshal(chunk)
		if err != nil {
			logger.Error("Failed to marshal chunk", "err", err)
			return emptyResponse, plainTextResponseMessage, err
		}

		_, err = e.Response.Write(
			append(append(headerData, marshalledChunk...), newLine...),
		)
		if err != nil {
			logger.Error("Failed to write to response", "err", err)
			return emptyResponse, plainTextResponseMessage, err
		}

		if err := e.Flush(); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return emptyResponse, plainTextResponseMessage, err
		}
	}

	plainTextResponseMessage = sb.String()

	return
}

func ForwardOpenAIResponse(
	e *core.RequestEvent,
	req openai.ChatCompletionRequest,
	logger *slog.Logger,
	client *openai.Client,
) (resp openai.ChatCompletionResponse, plainTextResponseMessage string, err error) {
	emptyResponse := openai.ChatCompletionResponse{}

	resp, err = client.CreateChatCompletion(
		e.Request.Context(),
		req,
	)
	if err != nil {
		return emptyResponse, plainTextResponseMessage, err
	}

	plainTextResponseMessage = resp.Choices[0].Message.Content

	return
}
