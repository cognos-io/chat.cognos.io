package proxy

import (
	"fmt"
	"log/slog"

	"github.com/google/generative-ai-go/genai"
	"github.com/liushuangls/go-anthropic/v2"
	"github.com/sashabaranov/go-openai"
)

type RepoParams struct {
	Logger                 *slog.Logger
	OpenAIClient           *openai.Client
	CloudflareOpenAIClient *openai.Client
	AnthropicClient        *anthropic.Client
	GoogleGeminiAIClient   *genai.Client
	DeepInfraOpenAIClient  *openai.Client
}

type UpstreamRepo interface {
	Provider(provider string) (Upstream, error)
}

type InMemoryUpstreamRepo struct {
	openAIClient           *openai.Client
	cloudflareOpenAIClient *openai.Client
	anthropicClient        *anthropic.Client
	googleGeminiAIClient   *genai.Client
	deepinfraOpenAIClient  *openai.Client
	logger                 *slog.Logger
}

func (r *InMemoryUpstreamRepo) Provider(provider string) (Upstream, error) {
	switch provider {
	case "openai":
		return NewOpenAI(r.openAIClient, r.logger)
	case "cloudflare":
		return NewCloudflare(r.cloudflareOpenAIClient, r.logger)
	case "google":
		return NewGoogleGemini(r.googleGeminiAIClient, r.logger)
	case "anthropic":
		return NewAnthropic(r.anthropicClient, r.logger)
	case "deepinfra":
		return NewDeepInfra(r.deepinfraOpenAIClient, r.logger)
	case "fireworks":
	case "together":
	case "groq":
	case "x":
	default:
		return nil, fmt.Errorf("invalid model provider: %s", provider)
	}
	return nil, fmt.Errorf("unable to find provider: %s", provider)
}

func NewInMemoryUpstreamRepo(params RepoParams,
) *InMemoryUpstreamRepo {
	return &InMemoryUpstreamRepo{
		logger:                 params.Logger,
		openAIClient:           params.OpenAIClient,
		cloudflareOpenAIClient: params.CloudflareOpenAIClient,
		anthropicClient:        params.AnthropicClient,
		googleGeminiAIClient:   params.GoogleGeminiAIClient,
		deepinfraOpenAIClient:  params.DeepInfraOpenAIClient,
	}
}
