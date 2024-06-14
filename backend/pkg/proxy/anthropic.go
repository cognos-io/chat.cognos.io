package proxy

import (
	"fmt"
	"log/slog"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/labstack/echo/v5"
	"github.com/sashabaranov/go-openai"
)

var anthropicModelMapping = map[string]string{
	"claude-haiku":  "claude-3-haiku-20240307",
	"claude-sonnet": "claude-3-sonnet-20240229",
	"claude-opus":   "claude-3-opus-20240229",
}

// compile time type checking
var _ Upstream = (*Anthropic)(nil)

func NewAnthropicOpenAIClient(config *config.APIConfig) *openai.Client {
	openAIConfig := openai.DefaultConfig(config.AnthropicAPIKey)
	openAIConfig.BaseURL = config.AnthropicAPIURL
	return openai.NewClientWithConfig(openAIConfig)
}

type Anthropic struct {
	client *openai.Client
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
	if req.Stream {
		return StreamOpenAIResponse(c, req, a.logger, a.client)
	}
	return ForwardOpenAIResponse(c, req, a.logger, a.client)
}

func NewAnthropic(
	client *openai.Client,
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
