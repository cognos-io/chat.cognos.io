package gateway

import (
	"bytes"
	"context"
	"encoding/base64"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func TestBifrostClientGenerateImageMapsRequestAndDecodesBytes(t *testing.T) {
	t.Parallel()

	want := []byte("\x89PNG\r\n\x1a\n fake image bytes")
	requester := &stubBifrostRequester{
		imageResp: &schemas.BifrostImageGenerationResponse{
			Data: []schemas.ImageData{
				{B64JSON: base64.StdEncoding.EncodeToString(want), Index: 0},
			},
			Usage: &schemas.ImageUsage{InputTokens: 12, OutputTokens: 1290, TotalTokens: 1302},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	resp, err := client.GenerateImage(context.Background(), ImageRequest{
		ProviderID:      "requesty",
		ProviderModelID: "google/gemini-2.5-flash-image",
		Prompt:          "a watercolor fox in a library",
		OutputFormat:    "png",
	})
	if err != nil {
		t.Fatalf("GenerateImage returned error: %v", err)
	}

	// Request mapping.
	if requester.imageReq == nil {
		t.Fatal("expected an image request to be sent")
	}
	if got := string(requester.imageReq.Provider); got != "requesty" {
		t.Errorf("provider = %q, want requesty", got)
	}
	if requester.imageReq.Model != "google/gemini-2.5-flash-image" {
		t.Errorf("model = %q", requester.imageReq.Model)
	}
	if requester.imageReq.Input == nil || requester.imageReq.Input.Prompt != "a watercolor fox in a library" {
		t.Errorf("prompt not mapped: %+v", requester.imageReq.Input)
	}
	if requester.imageReq.Params == nil || requester.imageReq.Params.ResponseFormat == nil ||
		*requester.imageReq.Params.ResponseFormat != "b64_json" {
		t.Errorf("expected response_format=b64_json so bytes return inline, got %+v", requester.imageReq.Params)
	}

	// Response decoding.
	if len(resp.Images) != 1 {
		t.Fatalf("expected 1 image, got %d", len(resp.Images))
	}
	if !bytes.Equal(resp.Images[0].Bytes, want) {
		t.Errorf("decoded bytes mismatch")
	}
	if resp.Images[0].MimeType != "image/png" {
		t.Errorf("mime = %q, want image/png", resp.Images[0].MimeType)
	}
	if resp.Images[0].URL != "" {
		t.Errorf("expected no URL when bytes are inline, got %q", resp.Images[0].URL)
	}

	// Usage threaded for billing; image usage carries no provider cost.
	if resp.Usage.InputTokens != 12 || resp.Usage.OutputTokens != 1290 {
		t.Errorf("usage = %+v", resp.Usage)
	}
	if resp.Usage.ProviderCostUSD != nil {
		t.Errorf("expected nil provider cost for image usage, got %v", *resp.Usage.ProviderCostUSD)
	}
}

func TestBifrostClientGenerateImagePropagatesSafeError(t *testing.T) {
	t.Parallel()

	status := 400
	errType := "invalid_request_error"
	requester := &stubBifrostRequester{
		imageErr: &schemas.BifrostError{
			StatusCode: &status,
			Error:      &schemas.ErrorField{Type: &errType, Message: "prompt: a watercolor fox in a library"},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	_, err := client.GenerateImage(context.Background(), ImageRequest{
		ProviderID:      "requesty",
		ProviderModelID: "google/gemini-2.5-flash-image",
		Prompt:          "a watercolor fox in a library",
	})
	if err == nil {
		t.Fatal("expected an error")
	}
	// The free-text provider message can echo the prompt, so it must never
	// appear in the error we surface.
	want := "bifrost image request failed: status=400 type=invalid_request_error"
	if got := err.Error(); got != want {
		t.Errorf("error = %q, want safe summary %q", got, want)
	}
}

func TestBifrostClientGenerateImageRejectsEmptyPrompt(t *testing.T) {
	t.Parallel()

	requester := &stubBifrostRequester{}
	client := NewBifrostClient(requester, nil, nil, nil)

	_, err := client.GenerateImage(context.Background(), ImageRequest{
		ProviderID:      "requesty",
		ProviderModelID: "google/gemini-2.5-flash-image",
		Prompt:          "   ",
	})
	if err == nil {
		t.Fatal("expected an error for empty prompt")
	}
	if requester.imageReq != nil {
		t.Error("provider must not be called when the prompt is empty")
	}
}
