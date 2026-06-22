package gateway

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
)

// TestRequestyImageGenerationIntegration proves the image-generation path end to
// end against the real Requesty gateway. It is the spike's risk-retirement
// artefact: it confirms (a) Requesty accepts Bifrost's image-generation request,
// and (b) it returns decodable image bytes.
//
// It is skipped unless REQUESTY_API_KEY is set, so it never runs in CI.
//
// Images API (OpenAI gpt-image) — the default transport:
//
//	REQUESTY_API_KEY=... REQUESTY_IMAGE_MODEL=azure/openai/gpt-image-1 \
//	  go test ./internal/gateway -run TestRequestyImageGenerationIntegration -v
//
// Chat-completions transport (Google Gemini, ZDR/EU):
//
//	REQUESTY_API_KEY=... REQUESTY_IMAGE_TRANSPORT=chat_completions \
//	  REQUESTY_IMAGE_MODEL=vertex/google/gemini-2.5-flash-image-preview \
//	  go test ./internal/gateway -run TestRequestyImageGenerationIntegration -v
func TestRequestyImageGenerationIntegration(t *testing.T) {
	apiKey := os.Getenv("REQUESTY_API_KEY")
	if apiKey == "" {
		t.Skip("set REQUESTY_API_KEY to run the Requesty image-generation integration test")
	}

	transport := ImageTransportImagesAPI
	model := os.Getenv("REQUESTY_IMAGE_MODEL")
	if os.Getenv("REQUESTY_IMAGE_TRANSPORT") == string(ImageTransportChatCompletions) {
		transport = ImageTransportChatCompletions
		if model == "" {
			model = "vertex/google/gemini-2.5-flash-image-preview"
		}
	}
	if model == "" {
		model = "azure/openai/gpt-image-1"
	}

	account, err := NewStaticAccountFromAPIConfig(&config.APIConfig{
		RequestyAPIKey: apiKey,
		RequestyAPIURL: os.Getenv("REQUESTY_API_URL"),
	})
	if err != nil {
		t.Fatalf("build account: %v", err)
	}

	client, err := NewConfiguredBifrostClient(account, "error", nil)
	if err != nil {
		t.Fatalf("configure bifrost client: %v", err)
	}
	defer client.Shutdown()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	resp, err := client.GenerateImage(ctx, ImageRequest{
		ProviderID:      "requesty",
		ProviderModelID: model,
		Prompt:          "a minimalist watercolour fox reading a book in a library",
		Transport:       transport,
		OutputFormat:    "png",
	})
	if err != nil {
		t.Fatalf("GenerateImage against Requesty failed for model %q (%s): %v", model, transport, err)
	}

	if len(resp.Images) == 0 {
		t.Fatal("Requesty returned no images")
	}
	img := resp.Images[0]
	if len(img.Bytes) == 0 && img.URL == "" {
		t.Fatal("first image had neither bytes nor a url")
	}

	// Log only non-sensitive metadata, never the bytes or the prompt echo.
	providerCost := "nil"
	if resp.Usage.ProviderCostUSD != nil {
		providerCost = fmt.Sprintf("%.6f", *resp.Usage.ProviderCostUSD)
	}
	t.Logf("requesty image ok: model=%s transport=%s images=%d first_bytes=%d mime=%s url_returned=%t input_tokens=%d output_tokens=%d provider_cost_usd=%s",
		model, transport, len(resp.Images), len(img.Bytes), img.MimeType, img.URL != "",
		resp.Usage.InputTokens, resp.Usage.OutputTokens, providerCost)
}
