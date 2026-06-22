package gateway

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
)

// GenerateImage performs an explicit image-generation request against the
// configured provider via Bifrost's dedicated image API. We always request
// inline bytes (b64_json) so the provider returns the image directly and Cognos
// never has to persist a temporary plaintext provider URL.
func (c *BifrostClient) GenerateImage(ctx context.Context, req ImageRequest) (ImageResponse, error) {
	if c == nil || c.requester == nil {
		return ImageResponse{}, fmt.Errorf("bifrost client is not configured")
	}

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

func buildImageRequest(req ImageRequest) (*schemas.BifrostImageGenerationRequest, error) {
	if strings.TrimSpace(req.ProviderID) == "" {
		return nil, fmt.Errorf("bifrost provider id is required")
	}
	if strings.TrimSpace(req.ProviderModelID) == "" {
		return nil, fmt.Errorf("bifrost model id is required")
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return nil, fmt.Errorf("image prompt is required")
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
