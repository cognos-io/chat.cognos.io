package proxy

import "context"

type ProxyConfig struct {
	BaseURL                string // Base URL of the upstream server
	CompletePath           string // Path for the `complete` endpoint
	StreamCompletePath     string // Path for the `stream-complete` endpoint
	ChatCompletePath       string // Path for the `chat-complete` endpoint
	StreamChatCompletePath string // Path for the `stream-chat-complete` endpoint
}

type ChatCompletionRequest struct {
	Messages  []string `json:"messages"`
	MaxTokens int      `json:"max_tokens"`
	Stream    bool     `json:"stream"`
}

type ChatCompletionResponse struct{}

type Upstream interface {
	ChatCompletion(
		ctx context.Context,
		config *ProxyConfig,
		request ChatCompletionRequest,
	) (ChatCompletionResponse, error)
}
