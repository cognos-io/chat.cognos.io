package proxy

import (
	"fmt"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/sashabaranov/go-openai"
)

func NewInfomaniakOpenAIClient(config *config.APIConfig) *openai.Client {
	if config == nil || config.InfomaniakAPIKey == "" || config.InfomaniakProductID == "" {
		return nil
	}

	openAIConfig := openai.DefaultConfig(config.InfomaniakAPIKey)
	openAIConfig.BaseURL = fmt.Sprintf(
		"https://api.infomaniak.com/2/ai/%s/openai/v1",
		config.InfomaniakProductID,
	)

	return openai.NewClientWithConfig(openAIConfig)
}
