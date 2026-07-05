package gateway

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
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

func TestBifrostClientGenerateImageViaChatParsesRawResponse(t *testing.T) {
	t.Parallel()

	want := []byte("\x89PNG\r\n\x1a\n fake gemini image bytes")
	dataURI := "data:image/png;base64," + base64.StdEncoding.EncodeToString(want)
	// Mirrors the real Requesty shape: cost lives at usage.cost in the raw JSON,
	// NOT in Bifrost's typed usage.Cost.
	cost := 0.0387346
	rawResponse := json.RawMessage(fmt.Sprintf(`{
		"choices": [{
			"index": 0,
			"message": {
				"role": "assistant",
				"content": "Here is your image.",
				"images": [{"type": "image_url", "image_url": {"url": %q}}]
			}
		}],
		"usage": {"prompt_tokens": 7, "completion_tokens": 1303, "total_tokens": 1310, "cost": %v}
	}`, dataURI, cost))

	requester := &stubBifrostRequester{
		resp: &schemas.BifrostChatResponse{
			ExtraFields: schemas.BifrostResponseExtraFields{RawResponse: rawResponse},
			// Typed usage carries tokens but no cost, exactly as Bifrost returns it.
			Usage: &schemas.BifrostLLMUsage{
				PromptTokens:     7,
				CompletionTokens: 1303,
				TotalTokens:      1310,
			},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	resp, err := client.GenerateImage(context.Background(), ImageRequest{
		ProviderID:      "requesty",
		ProviderModelID: "vertex/google/gemini-2.5-flash-image-preview",
		Prompt:          "a watercolour fox in a library",
		Transport:       ImageTransportChatCompletions,
		OutputFormat:    "png",
	})
	if err != nil {
		t.Fatalf("GenerateImage (chat) returned error: %v", err)
	}

	// It must route to the chat endpoint, with raw-response capture enabled.
	if requester.req == nil {
		t.Fatal("expected a chat completion request to be sent")
	}
	if requester.imageReq != nil {
		t.Error("chat transport must not call the images endpoint")
	}

	if len(resp.Images) != 1 {
		t.Fatalf("expected 1 image, got %d", len(resp.Images))
	}
	if !bytes.Equal(resp.Images[0].Bytes, want) {
		t.Error("decoded image bytes mismatch")
	}
	if resp.Images[0].MimeType != "image/png" {
		t.Errorf("mime = %q, want image/png", resp.Images[0].MimeType)
	}
	// Cost is read from the raw usage.cost field; billing prefers it.
	if resp.Usage.ProviderCostUSD == nil || *resp.Usage.ProviderCostUSD != cost {
		t.Errorf("provider cost = %v, want %v", resp.Usage.ProviderCostUSD, cost)
	}
	// Tokens come from Bifrost's typed usage.
	if resp.Usage.OutputTokens != 1303 {
		t.Errorf("output tokens = %d, want 1303", resp.Usage.OutputTokens)
	}
}

func TestBifrostClientGenerateImageViaChatReturnsTextFallback(t *testing.T) {
	t.Parallel()

	// A text-only chat response (no images array) is a valid answer — a refusal,
	// clarifying question, or description — not a failure. The client surfaces
	// the text so the caller can persist it as a normal message.
	rawResponse := json.RawMessage(`{"choices":[{"message":{"role":"assistant","content":"I can't generate that, but I can describe it."}}]}`)
	requester := &stubBifrostRequester{
		resp: &schemas.BifrostChatResponse{
			ExtraFields: schemas.BifrostResponseExtraFields{RawResponse: rawResponse},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	resp, err := client.GenerateImage(context.Background(), ImageRequest{
		ProviderID:      "requesty",
		ProviderModelID: "vertex/google/gemini-2.5-flash-image-preview",
		Prompt:          "a watercolour fox",
		Transport:       ImageTransportChatCompletions,
	})
	if err != nil {
		t.Fatalf("expected no error for a text-only response, got %v", err)
	}
	if len(resp.Images) != 0 {
		t.Errorf("expected no images, got %d", len(resp.Images))
	}
	if resp.Text != "I can't generate that, but I can describe it." {
		t.Errorf("text = %q, want the model's reply", resp.Text)
	}
}

func TestBifrostClientGenerateImageViaChatErrorsWhenEmpty(t *testing.T) {
	t.Parallel()

	// A truly empty response (no image AND no text) is still a clear error, not a
	// silent empty success.
	rawResponse := json.RawMessage(`{"choices":[{"message":{"role":"assistant","content":""}}]}`)
	requester := &stubBifrostRequester{
		resp: &schemas.BifrostChatResponse{
			ExtraFields: schemas.BifrostResponseExtraFields{RawResponse: rawResponse},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	_, err := client.GenerateImage(context.Background(), ImageRequest{
		ProviderID:      "requesty",
		ProviderModelID: "vertex/google/gemini-2.5-flash-image-preview",
		Prompt:          "a watercolour fox",
		Transport:       ImageTransportChatCompletions,
	})
	if err == nil {
		t.Fatal("expected an error when the chat response carries neither image nor text")
	}
}

func TestBifrostClientGenerateImageViaChatSendsHistory(t *testing.T) {
	t.Parallel()

	// When history is supplied it must all reach the provider (oldest-first),
	// so a chat-transport image model keeps context ("make it blue" refers to
	// the earlier turn). Return text so the call succeeds without image bytes.
	rawResponse := json.RawMessage(`{"choices":[{"message":{"role":"assistant","content":"ok"}}]}`)
	requester := &stubBifrostRequester{
		resp: &schemas.BifrostChatResponse{
			ExtraFields: schemas.BifrostResponseExtraFields{RawResponse: rawResponse},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	_, err := client.GenerateImage(context.Background(), ImageRequest{
		ProviderID:      "requesty",
		ProviderModelID: "vertex/google/gemini-2.5-flash-image-preview",
		Prompt:          "make it blue",
		Transport:       ImageTransportChatCompletions,
		Messages: []Message{
			{Role: "user", Content: "draw a fox"},
			{Role: "assistant", Content: "here is a fox"},
			{Role: "user", Content: "make it blue"},
		},
	})
	if err != nil {
		t.Fatalf("GenerateImage returned error: %v", err)
	}
	if requester.req == nil {
		t.Fatal("expected a chat completion request to be sent")
	}
	if got := len(requester.req.Input); got != 3 {
		t.Fatalf("sent %d messages, want 3 (full history)", got)
	}
	if requester.req.Input[0].Role != schemas.ChatMessageRoleUser ||
		requester.req.Input[1].Role != schemas.ChatMessageRoleAssistant {
		t.Errorf("roles not mapped in order: %v, %v",
			requester.req.Input[0].Role, requester.req.Input[1].Role)
	}
	if requester.req.Input[0].Content == nil || requester.req.Input[0].Content.ContentStr == nil ||
		*requester.req.Input[0].Content.ContentStr != "draw a fox" {
		t.Errorf("first message content not mapped: %+v", requester.req.Input[0].Content)
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
