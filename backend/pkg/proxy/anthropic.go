package proxy

import (
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/liushuangls/go-anthropic/v2"
	"github.com/pocketbase/pocketbase/core"
	"github.com/sashabaranov/go-openai"
)

const anthropicMaxTokens = 4096

var anthropicModelMapping = map[string]anthropic.Model{
	"claude-haiku":     anthropic.ModelClaude3Haiku20240307,
	"claude-sonnet":    anthropic.ModelClaude3Sonnet20240229,
	"claude-opus":      anthropic.ModelClaude3Opus20240229,
	"claude-sonnet3.5": anthropic.ModelClaude3Dot5Sonnet20240620,
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
	model, err := AnthropicModelMapper(internalModel)
	return string(model), err
}

func (a *Anthropic) EnsureNoRetention() error {
	return ErrNoRetentionUnsupported
}

func (a *Anthropic) ChatCompletion(
	e *core.RequestEvent,
	req openai.ChatCompletionRequest,
) (response openai.ChatCompletionResponse, plainTextResponseMessage string, err error) {
	anthropicReq := anthropic.MessagesRequest{
		Model:     anthropic.Model(req.Model),
		Stream:    req.Stream,
		MaxTokens: req.MaxTokens,
	}

	if req.Temperature != 0 {
		anthropicReq.Temperature = &req.Temperature
	}
	if req.TopP != 0 {
		anthropicReq.TopP = &req.TopP
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
		e.Request.Context(),
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

func AnthropicModelMapper(model string) (anthropic.Model, error) {
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
