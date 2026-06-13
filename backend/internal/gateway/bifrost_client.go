package gateway

import (
	"context"
	"fmt"
	"strings"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
)

type bifrostRequester interface {
	ChatCompletionRequest(ctx *schemas.BifrostContext, req *schemas.BifrostChatRequest) (*schemas.BifrostChatResponse, *schemas.BifrostError)
}

type bifrostShutdowner interface {
	Shutdown()
}

type BifrostClient struct {
	requester bifrostRequester
	shutdown  bifrostShutdowner
	account   schemas.Account
}

func NewBifrostClient(requester bifrostRequester, shutdown bifrostShutdowner, account schemas.Account) *BifrostClient {
	return &BifrostClient{
		requester: requester,
		shutdown:  shutdown,
		account:   account,
	}
}

func NewConfiguredBifrostClient(account schemas.Account) (*BifrostClient, error) {
	if account == nil {
		return nil, fmt.Errorf("bifrost account is required")
	}

	runtime, err := bifrost.Init(context.Background(), schemas.BifrostConfig{
		Account:         account,
		InitialPoolSize: schemas.DefaultInitialPoolSize,
		Logger:          bifrost.NewDefaultLogger(schemas.LogLevelError),
	})
	if err != nil {
		return nil, err
	}

	return NewBifrostClient(runtime, runtime, account), nil
}

func (c *BifrostClient) Shutdown() {
	if c == nil || c.shutdown == nil {
		return
	}
	c.shutdown.Shutdown()
}

func (c *BifrostClient) Account() schemas.Account {
	if c == nil {
		return nil
	}
	return c.account
}

func (c *BifrostClient) Complete(ctx context.Context, req CompleteRequest) (CompleteResponse, error) {
	if c == nil || c.requester == nil {
		return CompleteResponse{}, fmt.Errorf("bifrost client is not configured")
	}
	if strings.TrimSpace(req.ProviderID) == "" {
		return CompleteResponse{}, fmt.Errorf("bifrost provider id is required")
	}
	if strings.TrimSpace(req.ProviderModelID) == "" {
		return CompleteResponse{}, fmt.Errorf("bifrost model id is required")
	}

	messages := make([]schemas.ChatMessage, 0, len(req.Messages))
	for _, message := range req.Messages {
		content := message.Content
		name := strings.TrimSpace(message.Name)
		messages = append(messages, schemas.ChatMessage{
			Name: nullableString(name),
			Role: schemas.ChatMessageRole(message.Role),
			Content: &schemas.ChatMessageContent{
				ContentStr: &content,
			},
		})
	}

	chatReq := &schemas.BifrostChatRequest{
		Provider: schemas.ModelProvider(req.ProviderID),
		Model:    req.ProviderModelID,
		Input:    messages,
	}
	if req.MaxOutputTokens > 0 {
		chatReq.Params = &schemas.ChatParameters{MaxCompletionTokens: &req.MaxOutputTokens}
	}

	bifrostCtx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	resp, bifrostErr := c.requester.ChatCompletionRequest(bifrostCtx, chatReq)
	if bifrostErr != nil {
		return CompleteResponse{}, fmt.Errorf("bifrost request failed: %s", bifrostErr.GetErrorString())
	}
	if resp == nil {
		return CompleteResponse{}, fmt.Errorf("bifrost returned nil response")
	}
	if len(resp.Choices) == 0 {
		return CompleteResponse{}, fmt.Errorf("bifrost returned no completion choices")
	}

	message := resp.Choices[0].Message
	if message == nil {
		return CompleteResponse{}, fmt.Errorf("bifrost returned an empty completion message")
	}

	content := extractMessageContent(message)
	usage := resp.Usage
	if usage == nil {
		usage = &schemas.BifrostLLMUsage{}
	}

	var providerCostUSD *float64
	if usage.Cost != nil {
		totalCost := usage.Cost.TotalCost
		providerCostUSD = &totalCost
	}

	return CompleteResponse{
		Message: Message{
			Role:    string(message.Role),
			Content: content,
		},
		Usage: Usage{
			InputTokens:              int64(usage.PromptTokens),
			OutputTokens:             int64(usage.CompletionTokens),
			TotalTokens:              int64(usage.TotalTokens),
			CacheCreationInputTokens: int64(cachedWriteTokens(usage)),
			CacheReadInputTokens:     int64(cachedReadTokens(usage)),
			ProviderCostUSD:          providerCostUSD,
		},
	}, nil
}

func extractMessageContent(message *schemas.ChatMessage) string {
	if message == nil || message.Content == nil {
		return ""
	}
	if message.Content.ContentStr != nil {
		return *message.Content.ContentStr
	}

	var builder strings.Builder
	for _, block := range message.Content.ContentBlocks {
		if block.Text != nil {
			builder.WriteString(*block.Text)
		}
	}
	return builder.String()
}

func cachedReadTokens(usage *schemas.BifrostLLMUsage) int {
	if usage == nil || usage.PromptTokensDetails == nil {
		return 0
	}
	return usage.PromptTokensDetails.CachedReadTokens
}

func cachedWriteTokens(usage *schemas.BifrostLLMUsage) int {
	if usage == nil || usage.PromptTokensDetails == nil {
		return 0
	}
	if usage.PromptTokensDetails.CachedWriteTokenDetails != nil {
		return usage.PromptTokensDetails.CachedWriteTokenDetails.CachedWriteTokens5m +
			usage.PromptTokensDetails.CachedWriteTokenDetails.CachedWriteTokens1h
	}
	return usage.PromptTokensDetails.CachedWriteTokens
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
