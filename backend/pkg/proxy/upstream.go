package proxy

type ProxyConfig struct {
	BaseURL                string // Base URL of the upstream server
	CompletePath           string // Path for the `complete` endpoint
	StreamCompletePath     string // Path for the `stream-complete` endpoint
	ChatCompletePath       string // Path for the `chat-complete` endpoint
	StreamChatCompletePath string // Path for the `stream-chat-complete` endpoint
}

type Upstream interface{}
