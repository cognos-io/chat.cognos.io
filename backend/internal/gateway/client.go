package gateway

import "context"

type Message struct {
	Role    string
	Content string
	Name    string
}

type CompleteRequest struct {
	ProviderID      string
	ProviderModelID string
	Messages        []Message
	MaxOutputTokens int
}

type Usage struct {
	InputTokens              int64
	OutputTokens             int64
	TotalTokens              int64
	CacheCreationInputTokens int64
	CacheReadInputTokens     int64
	ProviderCostUSD          *float64
}

type CompleteResponse struct {
	Message Message
	Usage   Usage
}

type CompleteStreamEvent struct {
	Delta string
	Usage *Usage
	Err   error
}

type Client interface {
	Complete(ctx context.Context, req CompleteRequest) (CompleteResponse, error)
	CompleteStream(ctx context.Context, req CompleteRequest) (<-chan CompleteStreamEvent, error)
}
