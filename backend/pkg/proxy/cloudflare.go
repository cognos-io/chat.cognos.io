package proxy

import (
	"fmt"
	"log/slog"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/labstack/echo/v5"
	"github.com/sashabaranov/go-openai"
)

var cfModelMapping = map[string]string{
	"llama-3-8b-instruct": "@cf/meta/llama-3-8b-instruct",
}

func NewCloudflareOpenAIClient(config *config.APIConfig) *openai.Client {
	openAIConfig := openai.DefaultConfig(config.CloudflareAPIKey)
	openAIConfig.BaseURL = fmt.Sprintf(
		"https://api.cloudflare.com/client/v4/accounts/%s/ai/v1",
		config.CloudflareAccountID,
	)
	return openai.NewClientWithConfig(openAIConfig)
}

func CloudflareModelMapper(model string) (string, error) {
	if mappedModel, ok := cfModelMapping[model]; ok {
		return mappedModel, nil
	}
	return "", fmt.Errorf("invalid model name: %s", model)
}

type Cloudflare struct {
	client *openai.Client
	logger *slog.Logger
}

func (cf *Cloudflare) LookupModel(
	internalModel string,
) (string, error) {
	return CloudflareModelMapper(internalModel)
}

func (cf *Cloudflare) ChatCompletion(
	c echo.Context,
	req openai.ChatCompletionRequest,
) (response openai.ChatCompletionResponse, plainTextResponseMessage string, err error) {
	if req.Stream {
		return StreamOpenAIResponse(c, req, cf.logger, cf.client)
	}
	return ForwardOpenAIResponse(c, req, cf.logger, cf.client)
}

func NewCloudflare(
	client *openai.Client,
	logger *slog.Logger,
) (*Cloudflare, error) {
	return &Cloudflare{
		client: client,
		logger: logger,
	}, nil
}
