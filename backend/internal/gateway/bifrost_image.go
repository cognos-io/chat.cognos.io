package gateway

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
)

// GenerateImage performs an explicit image-generation request against the
// configured provider, dispatching to the transport the model uses.
func (c *BifrostClient) GenerateImage(ctx context.Context, req ImageRequest) (ImageResponse, error) {
	if c == nil || c.requester == nil {
		return ImageResponse{}, fmt.Errorf("bifrost client is not configured")
	}

	switch req.Transport {
	case ImageTransportChatCompletions:
		return c.generateImageViaChat(ctx, req)
	default:
		return c.generateImageViaImagesAPI(ctx, req)
	}
}

// generateImageViaImagesAPI uses Bifrost's dedicated image API. We always
// request inline bytes (b64_json) so the provider returns the image directly and
// Cognos never has to persist a temporary plaintext provider URL.
func (c *BifrostClient) generateImageViaImagesAPI(ctx context.Context, req ImageRequest) (ImageResponse, error) {
	imageReq, err := buildImageRequest(req)
	if err != nil {
		return ImageResponse{}, err
	}

	bifrostCtx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	resp, bifrostErr := c.requester.ImageGenerationRequest(bifrostCtx, imageReq)
	if bifrostErr != nil {
		c.logProviderError(req.ProviderID, req.ProviderModelID, bifrostErr)
		return ImageResponse{}, fmt.Errorf("bifrost image request failed: %s", safeErrorSummary(bifrostErr))
	}
	if resp == nil {
		return ImageResponse{}, fmt.Errorf("bifrost returned nil image response")
	}
	if len(resp.Data) == 0 {
		return ImageResponse{}, fmt.Errorf("bifrost returned no generated images")
	}

	images := make([]GeneratedImage, 0, len(resp.Data))
	for _, data := range resp.Data {
		image, decodeErr := decodeGeneratedImage(data, req.OutputFormat)
		if decodeErr != nil {
			return ImageResponse{}, decodeErr
		}
		images = append(images, image)
	}

	return ImageResponse{
		Images: images,
		Usage:  imageUsage(resp.Usage),
	}, nil
}

func validateImageRequest(req ImageRequest) error {
	if strings.TrimSpace(req.ProviderID) == "" {
		return fmt.Errorf("bifrost provider id is required")
	}
	if strings.TrimSpace(req.ProviderModelID) == "" {
		return fmt.Errorf("bifrost model id is required")
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return fmt.Errorf("image prompt is required")
	}
	return nil
}

func buildImageRequest(req ImageRequest) (*schemas.BifrostImageGenerationRequest, error) {
	if err := validateImageRequest(req); err != nil {
		return nil, err
	}

	// b64_json keeps the bytes inline so we never receive (or persist) a
	// temporary provider URL pointing at a plaintext image.
	params := &schemas.ImageGenerationParameters{ResponseFormat: nullableString("b64_json")}
	if req.N > 0 {
		n := req.N
		params.N = &n
	}
	if size := strings.TrimSpace(req.Size); size != "" {
		params.Size = &size
	}
	if format := strings.TrimSpace(req.OutputFormat); format != "" {
		params.OutputFormat = &format
	}

	return &schemas.BifrostImageGenerationRequest{
		Provider: schemas.ModelProvider(strings.TrimSpace(req.ProviderID)),
		Model:    strings.TrimSpace(req.ProviderModelID),
		Input:    &schemas.ImageGenerationInput{Prompt: req.Prompt},
		Params:   params,
	}, nil
}

func decodeGeneratedImage(data schemas.ImageData, outputFormat string) (GeneratedImage, error) {
	mime := mimeForImageFormat(outputFormat)

	if data.B64JSON != "" {
		bytes, err := base64.StdEncoding.DecodeString(data.B64JSON)
		if err != nil {
			// The error wraps only the base64 decoder's message, never the payload.
			return GeneratedImage{}, fmt.Errorf("decode generated image: %w", err)
		}
		return GeneratedImage{Bytes: bytes, MimeType: mime}, nil
	}

	if data.URL != "" {
		return GeneratedImage{URL: data.URL, MimeType: mime}, nil
	}

	return GeneratedImage{}, fmt.Errorf("generated image had neither inline bytes nor a url")
}

func imageUsage(usage *schemas.ImageUsage) Usage {
	if usage == nil {
		return Usage{}
	}
	// ImageUsage carries no provider cost (unlike chat usage.Cost), so
	// ProviderCostUSD stays nil and billing falls back to token/per-image pricing.
	return Usage{
		InputTokens:  int64(usage.InputTokens),
		OutputTokens: int64(usage.OutputTokens),
		TotalTokens:  int64(usage.TotalTokens),
	}
}

func mimeForImageFormat(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "jpeg", "jpg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	default:
		return "image/png"
	}
}

// generateImageViaChat generates an image through the chat-completions API, used
// by models (e.g. Google Gemini) that return images inline at
// choices[].message.images[]. Bifrost's typed chat response does not model that
// array, so we enable raw-response capture for this single request and parse the
// image out of the raw provider JSON. The flag is set per request, never
// globally, so raw provider plaintext is not captured on the text-completion path.
func (c *BifrostClient) generateImageViaChat(ctx context.Context, req ImageRequest) (ImageResponse, error) {
	chatReq, err := buildImageChatRequest(req)
	if err != nil {
		return ImageResponse{}, err
	}

	// Capture the raw provider response so we can read the image out of
	// choices[].message.images[] (Bifrost's typed chat response drops it). The
	// per-request SendBackRawResponse override is only honoured when the
	// AllowPerRequestRawOverride flag is also set, so set both. Scoped to this
	// request only — raw provider plaintext is never captured for text chat.
	bifrostCtx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	bifrostCtx.SetValue(schemas.BifrostContextKeyAllowPerRequestRawOverride, true)
	bifrostCtx.SetValue(schemas.BifrostContextKeySendBackRawResponse, true)

	resp, bifrostErr := c.requester.ChatCompletionRequest(bifrostCtx, chatReq)
	if bifrostErr != nil {
		c.logProviderError(req.ProviderID, req.ProviderModelID, bifrostErr)
		return ImageResponse{}, fmt.Errorf("bifrost image chat request failed: %s", safeErrorSummary(bifrostErr))
	}
	if resp == nil {
		return ImageResponse{}, fmt.Errorf("bifrost returned nil image chat response")
	}

	images, providerCostUSD, err := extractChatImages(resp.ExtraFields.RawResponse, req.OutputFormat)
	if err != nil {
		return ImageResponse{}, err
	}
	if len(images) == 0 {
		return ImageResponse{}, fmt.Errorf("chat completion returned no generated images")
	}

	usage := chatImageUsage(resp.Usage)
	// Requesty reports cost on the raw usage object (`usage.cost`), which Bifrost's
	// typed usage does not carry. Prefer the raw value when present.
	if providerCostUSD != nil {
		usage.ProviderCostUSD = providerCostUSD
	}

	return ImageResponse{Images: images, Usage: usage}, nil
}

func buildImageChatRequest(req ImageRequest) (*schemas.BifrostChatRequest, error) {
	if err := validateImageRequest(req); err != nil {
		return nil, err
	}

	prompt := req.Prompt
	messages := []schemas.ChatMessage{{
		Role:    schemas.ChatMessageRoleUser,
		Content: &schemas.ChatMessageContent{ContentStr: &prompt},
	}}

	return &schemas.BifrostChatRequest{
		Provider: schemas.ModelProvider(strings.TrimSpace(req.ProviderID)),
		Model:    strings.TrimSpace(req.ProviderModelID),
		Input:    messages,
	}, nil
}

// extractChatImages parses generated images and the provider-reported cost out
// of the raw chat-completion JSON. Requesty returns images at
// choices[].message.images[].image_url.url as data URIs, and the cost at
// usage.cost (a field Bifrost's typed usage does not carry).
func extractChatImages(rawResponse interface{}, outputFormat string) (images []GeneratedImage, providerCostUSD *float64, err error) {
	rawBytes, err := rawJSONBytes(rawResponse)
	if err != nil {
		return nil, nil, err
	}
	if len(rawBytes) == 0 {
		return nil, nil, nil
	}

	var parsed struct {
		Choices []struct {
			Message struct {
				Images []struct {
					ImageURL struct {
						URL string `json:"url"`
					} `json:"image_url"`
				} `json:"images"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			Cost *float64 `json:"cost"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(rawBytes, &parsed); err != nil {
		return nil, nil, fmt.Errorf("parse chat image response: %w", err)
	}

	for _, choice := range parsed.Choices {
		for _, img := range choice.Message.Images {
			bytes, mime, decErr := decodeImageDataURI(img.ImageURL.URL, outputFormat)
			if decErr != nil {
				return nil, nil, decErr
			}
			images = append(images, GeneratedImage{Bytes: bytes, MimeType: mime})
		}
	}
	return images, parsed.Usage.Cost, nil
}

// decodeImageDataURI decodes a base64 data URI ("data:image/png;base64,...").
func decodeImageDataURI(uri, fallbackFormat string) (bytes []byte, mimeType string, err error) {
	if !strings.HasPrefix(uri, "data:") {
		// We never log the URI itself in case a provider returns a remote link
		// that could carry identifying query params.
		return nil, "", fmt.Errorf("expected an inline image data uri")
	}

	comma := strings.IndexByte(uri, ',')
	if comma < 0 {
		return nil, "", fmt.Errorf("malformed image data uri")
	}

	meta := uri[len("data:"):comma]
	mimeType = mimeForImageFormat(fallbackFormat)
	isBase64 := false
	for _, part := range strings.Split(meta, ";") {
		switch {
		case part == "base64":
			isBase64 = true
		case strings.HasPrefix(part, "image/"):
			mimeType = part
		}
	}
	if !isBase64 {
		return nil, "", fmt.Errorf("image data uri is not base64-encoded")
	}

	decoded, decodeErr := base64.StdEncoding.DecodeString(uri[comma+1:])
	if decodeErr != nil {
		return nil, "", fmt.Errorf("decode image data uri: %w", decodeErr)
	}
	return decoded, mimeType, nil
}

func rawJSONBytes(raw interface{}) ([]byte, error) {
	switch v := raw.(type) {
	case nil:
		return nil, nil
	case json.RawMessage:
		return v, nil
	case []byte:
		return v, nil
	case string:
		return []byte(v), nil
	default:
		marshalled, err := json.Marshal(v)
		if err != nil {
			return nil, fmt.Errorf("marshal raw response: %w", err)
		}
		return marshalled, nil
	}
}

// chatImageUsage maps chat usage for image generation. Unlike the Images API,
// the chat path may report a provider cost (usage.Cost), which billing prefers.
func chatImageUsage(usage *schemas.BifrostLLMUsage) Usage {
	if usage == nil {
		return Usage{}
	}
	var providerCostUSD *float64
	if usage.Cost != nil {
		totalCost := usage.Cost.TotalCost
		providerCostUSD = &totalCost
	}
	return Usage{
		InputTokens:     int64(usage.PromptTokens),
		OutputTokens:    int64(usage.CompletionTokens),
		TotalTokens:     int64(usage.TotalTokens),
		ProviderCostUSD: providerCostUSD,
	}
}
