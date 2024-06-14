package proxy

import (
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/liushuangls/go-anthropic/v2"
	"github.com/sashabaranov/go-openai"
)

const anthropicMaxTokens = 4096

var anthropicModelMapping = map[string]string{
	"claude-haiku":  anthropic.ModelClaude3Haiku20240307,
	"claude-sonnet": anthropic.ModelClaude3Sonnet20240229,
	"claude-opus":   anthropic.ModelClaude3Opus20240229,
}

var anthropicStopReasonToOpenAI = map[anthropic.MessagesStopReason]openai.FinishReason{
	anthropic.MessagesStopReasonEndTurn:      openai.FinishReasonNull,
	anthropic.MessagesStopReasonStopSequence: openai.FinishReasonStop,
	anthropic.MessagesStopReasonMaxTokens:    openai.FinishReasonLength,
	anthropic.MessagesStopReasonToolUse:      openai.FinishReasonToolCalls,
}

// compile time type checking
var _ Upstream = (*Anthropic)(nil)

type Anthropic struct {
	client *anthropic.Client
	logger *slog.Logger
}

func (a *Anthropic) LookupModel(
	internalModel string,
) (string, error) {
	return AnthropicModelMapper(internalModel)
}

func (a *Anthropic) ChatCompletion(
	c echo.Context,
	req openai.ChatCompletionRequest,
) (response openai.ChatCompletionResponse, plainTextResponseMessage string, err error) {
	anthropicReq := anthropic.MessagesRequest{
		Model:       req.Model,
		Stream:      req.Stream,
		Temperature: &req.Temperature,
		TopP:        &req.TopP,
	}

	if req.MaxTokens == 0 || req.MaxTokens > anthropicMaxTokens {
		// offer full length output
		anthropicReq.MaxTokens = anthropicMaxTokens
	}

	for _, message := range req.Messages {
		if message.Role == "system" {
			anthropicReq.System = message.Content
			continue
		}

		if message.Role == "user" {
			anthropicReq.Messages = append(
				anthropicReq.Messages,
				anthropic.NewUserTextMessage(message.Content),
			)
		}

		if message.Role == "assistant" {
			anthropicReq.Messages = append(
				anthropicReq.Messages,
				anthropic.NewAssistantTextMessage(message.Content),
			)
		}
	}

	if req.Stream {
		// TODO(ewan): Implement streaming
	}

	resp, err := a.client.CreateMessages(
		c.Request().Context(),
		anthropicReq,
	)
	if err != nil {
		return response, plainTextResponseMessage, err
	}

	sb := strings.Builder{}

	for _, message := range resp.Content {
		if message.Type == "text" {
			sb.WriteString(message.GetText())
		}
	}

	return AnthropicResponseToOpenAIResponse(resp), sb.String(), nil
}

func NewAnthropic(
	client *anthropic.Client,
	logger *slog.Logger,
) (*Anthropic, error) {
	return &Anthropic{
		logger: logger,
		client: client,
	}, nil
}

func AnthropicModelMapper(model string) (string, error) {
	if mappedModel, ok := anthropicModelMapping[model]; ok {
		return mappedModel, nil
	}
	return "", fmt.Errorf("invalid model name: %s", model)
}

func AnthropicResponseToOpenAIResponse(
	anthropicResp anthropic.MessagesResponse,
) openai.ChatCompletionResponse {
	// Convert the response from anthropic to openai
	openAIResponse := openai.ChatCompletionResponse{
		ID:      anthropicResp.ID,
		Created: time.Now().Unix(),
	}

	for _, message := range anthropicResp.Content {
		if message.Type == "text" {
			openAIResponse.Choices = append(
				openAIResponse.Choices,
				openai.ChatCompletionChoice{
					FinishReason: AnthropicStopReasonToOpenAI(anthropicResp.StopReason),
					Message: openai.ChatCompletionMessage{
						Content: message.GetText(),
						Role:    "assistant",
					},
				},
			)
		}
	}

	return openAIResponse
}

func AnthropicStopReasonToOpenAI(
	finishReason anthropic.MessagesStopReason,
) openai.FinishReason {
	if mappedFinishReason, ok := anthropicStopReasonToOpenAI[finishReason]; ok {
		return mappedFinishReason
	}
	return openai.FinishReasonNull
}
