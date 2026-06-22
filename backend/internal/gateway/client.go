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

// ImageTransport selects how an image is generated. Requesty exposes two,
// chosen per model: OpenAI gpt-image models use the dedicated Images API, while
// Google Gemini models return the image inline on a chat completion.
type ImageTransport string

const (
	// ImageTransportImagesAPI uses POST /v1/images/generations. Default.
	ImageTransportImagesAPI ImageTransport = "images_api"
	// ImageTransportChatCompletions uses POST /v1/chat/completions and reads the
	// image out of choices[].message.images[].
	ImageTransportChatCompletions ImageTransport = "chat_completions"
)

// ImageRequest is an explicit image-generation request. Image generation is a
// distinct operation from text completion — it is never inferred from prompt
// text — so it has its own request type and gateway method.
type ImageRequest struct {
	ProviderID      string
	ProviderModelID string
	Prompt          string
	// Transport selects the provider API. Empty defaults to the Images API.
	Transport ImageTransport
	// N is the number of images to generate (defaults to 1 when <= 0).
	N int
	// Size is an optional provider size hint such as "1024x1024".
	Size string
	// OutputFormat is an optional image format such as "png", "webp" or "jpeg".
	OutputFormat string
}

// GeneratedImage is one image returned by the provider. We always ask the
// provider for inline bytes (b64_json), so Bytes is normally populated. URL is
// only set if a provider ignored that and returned a temporary link instead —
// the caller must download it immediately and never persist the URL.
type GeneratedImage struct {
	Bytes    []byte
	URL      string
	MimeType string
}

type ImageResponse struct {
	Images []GeneratedImage
	Usage  Usage
}

type Client interface {
	Complete(ctx context.Context, req CompleteRequest) (CompleteResponse, error)
	CompleteStream(ctx context.Context, req CompleteRequest) (<-chan CompleteStreamEvent, error)
	GenerateImage(ctx context.Context, req ImageRequest) (ImageResponse, error)
}
