package proxy

import (
	"fmt"
	"log/slog"

	"github.com/sashabaranov/go-openai"
)

type UpstreamRepo interface {
	Provider(provider string) (Upstream, error)
}

type InMemoryUpstreamRepo struct {
	openAIClient           *openai.Client
	cloudflareOpenAIClient *openai.Client
	logger                 *slog.Logger
}

func (r *InMemoryUpstreamRepo) Provider(provider string) (Upstream, error) {
	switch provider {
	case "openai":
		return NewOpenAI(r.openAIClient, r.logger)
	case "cloudflare":
		return NewCloudflare(r.cloudflareOpenAIClient, r.logger)
	case "fireworks":
	case "together":
	case "anthropic":
	case "google":
	case "groq":
	case "x":
	default:
		return nil, fmt.Errorf("invalid model provider: %s", provider)
	}
	return nil, fmt.Errorf("unable to find provider: %s", provider)
}

func NewInMemoryUpstreamRepo(
	logger *slog.Logger,
	openAIClient *openai.Client,
	cloudflareOpenAIClient *openai.Client,
) *InMemoryUpstreamRepo {
	return &InMemoryUpstreamRepo{
		logger:                 logger,
		openAIClient:           openAIClient,
		cloudflareOpenAIClient: cloudflareOpenAIClient,
	}
}
