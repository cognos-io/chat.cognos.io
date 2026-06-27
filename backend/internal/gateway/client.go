package gateway

import "context"

type Message struct {
	Role    string
	Content string
	Name    string
	// Images attaches inline image inputs to this message for vision models.
	// When non-empty the message is sent as multimodal content blocks (text +
	// image_url) instead of a plain string.
	Images []MessageImage
	// Files attaches native file inputs (e.g. PDFs) for models that support
	// document input. Sent as `file` content blocks.
	Files []MessageFile
}

// MessageImage is an inline image input (base64, no data: prefix).
type MessageImage struct {
	Base64   string
	MimeType string
}

// MessageFile is a native file input (base64, no data: prefix).
type MessageFile struct {
	Base64   string
	MimeType string
	Filename string
}

type CompleteRequest struct {
	ProviderID      string
	ProviderModelID string
	Messages        []Message
	MaxOutputTokens int
	// ReasoningEffort, when set, asks the provider for that reasoning intensity
	// (e.g. "low", "medium", "high", or model-specific tiers like "ultra"). The
	// sentinel "off" disables reasoning. Empty means "don't send a reasoning
	// parameter" — the provider uses its own default.
	ReasoningEffort string
	// ReasoningMaxTokens, when > 0, is the explicit thinking-budget ceiling sent
	// to the provider (Anthropic's thinking.budget_tokens). We set it ourselves
	// rather than letting the router derive a budget from the effort, so we can
	// guarantee Anthropic's invariant that MaxOutputTokens > ReasoningMaxTokens.
	// Ignored when reasoning is off.
	ReasoningMaxTokens int
	// JSONResponseFormat asks the provider to return a valid JSON object
	// (OpenAI-compatible response_format: {"type":"json_object"}). Only set it for
	// models that advertise structured-output support; callers must still tolerate
	// non-JSON output, as not every provider honours the hint.
	JSONResponseFormat bool
}

type Usage struct {
	InputTokens              int64
	OutputTokens             int64
	TotalTokens              int64
	CacheCreationInputTokens int64
	CacheReadInputTokens     int64
	// ReasoningTokens is the number of tokens the provider reports spending on
	// internal reasoning/thinking. It is a count only — never the reasoning
	// text — and defaults to 0 for models that do not report it.
	ReasoningTokens int64
	ProviderCostUSD *float64
}

type CompleteResponse struct {
	Message Message
	// Reasoning is provider-returned reasoning text, when the model exposes it.
	// It is treated as assistant content: encrypted at rest, never logged.
	Reasoning string
	Usage     Usage
}

type CompleteStreamEvent struct {
	Delta string
	// ReasoningDelta is a chunk of provider reasoning text, kept separate from
	// Delta so it never mixes into the final answer.
	ReasoningDelta string
	Usage          *Usage
	Err            error
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
