package proxy

import (
	"context"
	"fmt"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/sashabaranov/go-openai"
)

type OpenAI struct {
	client *openai.Client
}

func (o *OpenAI) ChatCompletion(
	ctx context.Context,
	config *ProxyConfig,
	request ChatCompletionRequest,
) (ChatCompletionResponse, error) {
	return ChatCompletionResponse{}, nil
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
