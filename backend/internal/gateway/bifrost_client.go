package gateway

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
)

type bifrostRequester interface {
	ChatCompletionRequest(ctx *schemas.BifrostContext, req *schemas.BifrostChatRequest) (*schemas.BifrostChatResponse, *schemas.BifrostError)
	ChatCompletionStreamRequest(ctx *schemas.BifrostContext, req *schemas.BifrostChatRequest) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError)
}

type bifrostShutdowner interface {
	Shutdown()
}

type BifrostClient struct {
	requester bifrostRequester
	shutdown  bifrostShutdowner
	account   schemas.Account
	logger    *slog.Logger
}

func NewBifrostClient(
	requester bifrostRequester,
	shutdown bifrostShutdowner,
	account schemas.Account,
	logger *slog.Logger,
) *BifrostClient {
	return &BifrostClient{
		requester: requester,
		shutdown:  shutdown,
		account:   account,
		logger:    logger,
	}
}

func NewConfiguredBifrostClient(account schemas.Account, logLevel string, logger *slog.Logger) (*BifrostClient, error) {
	if account == nil {
		return nil, fmt.Errorf("bifrost account is required")
	}

	runtime, err := bifrost.Init(context.Background(), schemas.BifrostConfig{
		Account:         account,
		InitialPoolSize: schemas.DefaultInitialPoolSize,
		Logger:          bifrost.NewDefaultLogger(parseBifrostLogLevel(logLevel)),
	})
	if err != nil {
		return nil, err
	}

	return NewBifrostClient(runtime, runtime, account, logger), nil
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

	chatReq, err := c.buildChatRequest(req)
	if err != nil {
		return CompleteResponse{}, err
	}

	bifrostCtx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	resp, bifrostErr := c.requester.ChatCompletionRequest(bifrostCtx, chatReq)
	if bifrostErr != nil {
		c.logBifrostError(req, bifrostErr)
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

func (c *BifrostClient) CompleteStream(ctx context.Context, req CompleteRequest) (<-chan CompleteStreamEvent, error) {
	if c == nil || c.requester == nil {
		return nil, fmt.Errorf("bifrost client is not configured")
	}

	chatReq, err := c.buildChatRequest(req)
	if err != nil {
		return nil, err
	}

	bifrostCtx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	stream, bifrostErr := c.requester.ChatCompletionStreamRequest(bifrostCtx, chatReq)
	if bifrostErr != nil {
		c.logBifrostError(req, bifrostErr)
		return nil, fmt.Errorf("bifrost request failed: %s", bifrostErr.GetErrorString())
	}
	if stream == nil {
		return nil, fmt.Errorf("bifrost returned nil stream")
	}

	out := make(chan CompleteStreamEvent)
	go func() {
		defer close(out)

		for chunk := range stream {
			if chunk == nil {
				continue
			}
			if chunk.BifrostError != nil {
				c.logBifrostError(req, chunk.BifrostError)
				out <- CompleteStreamEvent{Err: fmt.Errorf("bifrost request failed: %s", chunk.BifrostError.GetErrorString())}
				return
			}
			if chunk.BifrostChatResponse == nil {
				continue
			}

			event := CompleteStreamEvent{}
			if usage := chunk.BifrostChatResponse.Usage; usage != nil {
				providerCostUSD := (*float64)(nil)
				if usage.Cost != nil {
					totalCost := usage.Cost.TotalCost
					providerCostUSD = &totalCost
				}
				event.Usage = &Usage{
					InputTokens:              int64(usage.PromptTokens),
					OutputTokens:             int64(usage.CompletionTokens),
					TotalTokens:              int64(usage.TotalTokens),
					CacheCreationInputTokens: int64(cachedWriteTokens(usage)),
					CacheReadInputTokens:     int64(cachedReadTokens(usage)),
					ProviderCostUSD:          providerCostUSD,
				}
			}

			for _, choice := range chunk.BifrostChatResponse.Choices {
				if choice.ChatStreamResponseChoice == nil || choice.ChatStreamResponseChoice.Delta == nil || choice.ChatStreamResponseChoice.Delta.Content == nil {
					continue
				}
				event.Delta += *choice.ChatStreamResponseChoice.Delta.Content
			}

			if event.Delta == "" && event.Usage == nil {
				continue
			}

			out <- event
		}
	}()

	return out, nil
}

func (c *BifrostClient) buildChatRequest(req CompleteRequest) (*schemas.BifrostChatRequest, error) {
	if strings.TrimSpace(req.ProviderID) == "" {
		return nil, fmt.Errorf("bifrost provider id is required")
	}
	if strings.TrimSpace(req.ProviderModelID) == "" {
		return nil, fmt.Errorf("bifrost model id is required")
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

	return chatReq, nil
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

func (c *BifrostClient) logBifrostError(req CompleteRequest, bifrostErr *schemas.BifrostError) {
	if c == nil || c.logger == nil || bifrostErr == nil {
		return
	}

	attrs := []any{
		"provider", strings.TrimSpace(req.ProviderID),
		"model", strings.TrimSpace(req.ProviderModelID),
		"status_code", derefInt(bifrostErr.StatusCode),
		"error_message", errorMessage(bifrostErr),
		"error_type", derefString(bifrostErrorType(bifrostErr)),
		"error_code", derefString(bifrostErrorCode(bifrostErr)),
		"original_model_requested", bifrostErr.ExtraFields.OriginalModelRequested,
		"resolved_model_used", bifrostErr.ExtraFields.ResolvedModelUsed,
	}
	c.logger.Error("bifrost request failed", attrs...)
}

func parseBifrostLogLevel(level string) schemas.LogLevel {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case string(schemas.LogLevelDebug):
		return schemas.LogLevelDebug
	case string(schemas.LogLevelInfo):
		return schemas.LogLevelInfo
	case string(schemas.LogLevelWarn):
		return schemas.LogLevelWarn
	default:
		return schemas.LogLevelError
	}
}

func bifrostErrorType(bifrostErr *schemas.BifrostError) *string {
	if bifrostErr == nil || bifrostErr.Error == nil {
		return nil
	}
	return bifrostErr.Error.Type
}

func bifrostErrorCode(bifrostErr *schemas.BifrostError) *string {
	if bifrostErr == nil || bifrostErr.Error == nil {
		return nil
	}
	return bifrostErr.Error.Code
}

func errorMessage(bifrostErr *schemas.BifrostError) string {
	if bifrostErr == nil {
		return ""
	}
	if bifrostErr.Error != nil && bifrostErr.Error.Message != "" {
		return bifrostErr.Error.Message
	}
	return bifrostErr.GetErrorString()
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func derefInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
