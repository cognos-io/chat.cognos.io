package gateway

import (
	"context"
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
// It is skipped unless REQUESTY_API_KEY is set, so it never runs in CI. Run it
// locally with, e.g.:
//
//	REQUESTY_API_KEY=... REQUESTY_IMAGE_MODEL=google/gemini-2.5-flash-image \
//	  go test ./internal/gateway -run TestRequestyImageGenerationIntegration -v
func TestRequestyImageGenerationIntegration(t *testing.T) {
	apiKey := os.Getenv("REQUESTY_API_KEY")
	if apiKey == "" {
		t.Skip("set REQUESTY_API_KEY to run the Requesty image-generation integration test")
	}

	model := os.Getenv("REQUESTY_IMAGE_MODEL")
	if model == "" {
		model = "google/gemini-2.5-flash-image"
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
		OutputFormat:    "png",
	})
	if err != nil {
		t.Fatalf("GenerateImage against Requesty failed for model %q: %v", model, err)
	}

	if len(resp.Images) == 0 {
		t.Fatal("Requesty returned no images")
	}
	img := resp.Images[0]
	if len(img.Bytes) == 0 && img.URL == "" {
		t.Fatal("first image had neither bytes nor a url")
	}

	// Log only non-sensitive metadata, never the bytes or the prompt echo.
	t.Logf("requesty image ok: model=%s images=%d first_bytes=%d mime=%s url_returned=%t input_tokens=%d output_tokens=%d",
		model, len(resp.Images), len(img.Bytes), img.MimeType, img.URL != "",
		resp.Usage.InputTokens, resp.Usage.OutputTokens)
}
