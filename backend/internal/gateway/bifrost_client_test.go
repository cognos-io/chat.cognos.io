package gateway

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

type stubBifrostRequester struct {
	resp      *schemas.BifrostChatResponse
	err       *schemas.BifrostError
	stream    chan *schemas.BifrostStreamChunk
	streamErr *schemas.BifrostError
	req       *schemas.BifrostChatRequest
	streamReq *schemas.BifrostChatRequest
}

func (s *stubBifrostRequester) ChatCompletionRequest(
	_ *schemas.BifrostContext,
	req *schemas.BifrostChatRequest,
) (*schemas.BifrostChatResponse, *schemas.BifrostError) {
	s.req = req
	return s.resp, s.err
}

func (s *stubBifrostRequester) ChatCompletionStreamRequest(
	_ *schemas.BifrostContext,
	req *schemas.BifrostChatRequest,
) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError) {
	s.streamReq = req
	return s.stream, s.streamErr
}

type stubBifrostShutdowner struct{ called bool }

func (s *stubBifrostShutdowner) Shutdown() { s.called = true }

func TestBifrostClientCompleteMapsRequestAndResponse(t *testing.T) {
	t.Parallel()

	requester := &stubBifrostRequester{
		resp: &schemas.BifrostChatResponse{
			Choices: []schemas.BifrostResponseChoice{{
				ChatNonStreamResponseChoice: &schemas.ChatNonStreamResponseChoice{
					Message: &schemas.ChatMessage{
						Role: schemas.ChatMessageRoleAssistant,
						Content: &schemas.ChatMessageContent{
							ContentStr: stringPtr("Hi there"),
						},
					},
				},
			}},
			Usage: &schemas.BifrostLLMUsage{
				PromptTokens:     12,
				CompletionTokens: 34,
				TotalTokens:      46,
				PromptTokensDetails: &schemas.ChatPromptTokensDetails{
					CachedReadTokens:  5,
					CachedWriteTokens: 6,
				},
				Cost: &schemas.BifrostCost{TotalCost: 0.42},
			},
		},
	}
	shutdowner := &stubBifrostShutdowner{}
	client := NewBifrostClient(requester, shutdowner, nil, nil)

	got, err := client.Complete(context.Background(), CompleteRequest{
		ProviderID:      "infomaniak",
		ProviderModelID: "llama-3.3-70b-instruct",
		Messages: []Message{{
			Role:    "user",
			Content: "Hello",
			Name:    "alice",
		}},
		MaxOutputTokens: 512,
	})
	if err != nil {
		t.Fatalf("Complete() error = %v, want nil", err)
	}
	if requester.req.Provider != schemas.ModelProvider("infomaniak") {
		t.Fatalf("request provider = %q, want %q", requester.req.Provider, "infomaniak")
	}
	if requester.req.Model != "llama-3.3-70b-instruct" {
		t.Fatalf("request model = %q, want %q", requester.req.Model, "llama-3.3-70b-instruct")
	}
	if requester.req.Params == nil || requester.req.Params.MaxCompletionTokens == nil || *requester.req.Params.MaxCompletionTokens != 512 {
		t.Fatalf("request max completion tokens = %#v, want 512", requester.req.Params)
	}
	if len(requester.req.Input) != 1 {
		t.Fatalf("len(request input) = %d, want %d", len(requester.req.Input), 1)
	}
	if requester.req.Input[0].Name == nil || *requester.req.Input[0].Name != "alice" {
		t.Fatalf("request name = %#v, want alice", requester.req.Input[0].Name)
	}
	if requester.req.Input[0].Content == nil || requester.req.Input[0].Content.ContentStr == nil || *requester.req.Input[0].Content.ContentStr != "Hello" {
		t.Fatalf("request content = %#v, want Hello", requester.req.Input[0].Content)
	}
	if got.Message.Role != "assistant" || got.Message.Content != "Hi there" {
		t.Fatalf("Complete() message = %#v, want assistant/Hi there", got.Message)
	}
	if got.Usage.InputTokens != 12 || got.Usage.OutputTokens != 34 || got.Usage.TotalTokens != 46 {
		t.Fatalf("Complete() usage = %#v", got.Usage)
	}
	if got.Usage.CacheReadInputTokens != 5 || got.Usage.CacheCreationInputTokens != 6 {
		t.Fatalf("Complete() cache usage = %#v", got.Usage)
	}
	if got.Usage.ProviderCostUSD == nil || *got.Usage.ProviderCostUSD != 0.42 {
		t.Fatalf("Complete() provider cost = %#v, want 0.42", got.Usage.ProviderCostUSD)
	}

	client.Shutdown()
	if !shutdowner.called {
		t.Fatal("Shutdown() did not call underlying shutdowner")
	}
}

func TestBifrostClientCompleteFlattensTextBlocks(t *testing.T) {
	t.Parallel()

	requester := &stubBifrostRequester{
		resp: &schemas.BifrostChatResponse{
			Choices: []schemas.BifrostResponseChoice{{
				ChatNonStreamResponseChoice: &schemas.ChatNonStreamResponseChoice{
					Message: &schemas.ChatMessage{
						Role: schemas.ChatMessageRoleAssistant,
						Content: &schemas.ChatMessageContent{
							ContentBlocks: []schemas.ChatContentBlock{
								{Text: stringPtr("Hello")},
								{Text: stringPtr(" world")},
							},
						},
					},
				},
			}},
		},
	}

	client := NewBifrostClient(requester, nil, nil, nil)
	got, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "model"})
	if err != nil {
		t.Fatalf("Complete() error = %v, want nil", err)
	}
	if got.Message.Content != "Hello world" {
		t.Fatalf("Complete() content = %q, want %q", got.Message.Content, "Hello world")
	}
}

func TestBifrostClientCompletePropagatesBifrostError(t *testing.T) {
	t.Parallel()

	// The provider's free-text message can echo request snippets (plaintext
	// user content), so it must never appear in the error we propagate.
	statusCode := 400
	errorType := "invalid_request_error"
	requester := &stubBifrostRequester{
		err: &schemas.BifrostError{
			StatusCode: &statusCode,
			Error: &schemas.ErrorField{
				Type:    &errorType,
				Message: "invalid token in messages[0]: 'my secret prompt'",
			},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	_, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "model"})
	if err == nil {
		t.Fatal("Complete() error = nil, want non-nil")
	}
	if strings.Contains(err.Error(), "my secret prompt") {
		t.Fatalf("Complete() error leaks the provider message: %v", err)
	}
	if want := "bifrost request failed: status=400 type=invalid_request_error"; err.Error() != want {
		t.Fatalf("Complete() error = %q, want %q", err.Error(), want)
	}
}

func TestBifrostClientCompleteLogsStructuredErrorFields(t *testing.T) {
	t.Parallel()

	var logBuf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logBuf, nil))
	statusCode := 404
	errorType := "provider_error"
	errorCode := "not_found"
	requester := &stubBifrostRequester{
		err: &schemas.BifrostError{
			StatusCode: &statusCode,
			Error: &schemas.ErrorField{
				Type:    &errorType,
				Code:    &errorCode,
				Message: "provider API error: {\"error\":\"not found\"}",
			},
			ExtraFields: schemas.BifrostErrorExtraFields{
				OriginalModelRequested: "google/gemma-4-31B-it",
				ResolvedModelUsed:      "google/gemma-4-31B-it",
			},
		},
	}
	client := NewBifrostClient(requester, nil, nil, logger)

	_, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "google/gemma-4-31B-it"})
	if err == nil {
		t.Fatal("Complete() error = nil, want non-nil")
	}

	for _, want := range []string{
		"\"msg\":\"bifrost request failed\"",
		"\"provider\":\"infomaniak\"",
		"\"model\":\"google/gemma-4-31B-it\"",
		"\"status_code\":404",
		"\"error_type\":\"provider_error\"",
		"\"error_code\":\"not_found\"",
		"\"resolved_model_used\":\"google/gemma-4-31B-it\"",
	} {
		if !strings.Contains(logBuf.String(), want) {
			t.Fatalf("log output = %s, want substring %s", logBuf.String(), want)
		}
	}

	// The provider's free-text message (which can contain plaintext user
	// content) must never be logged.
	for _, notWant := range []string{"error_message", "provider API error", "not found"} {
		if strings.Contains(logBuf.String(), notWant) {
			t.Fatalf("log output = %s, must not contain %q", logBuf.String(), notWant)
		}
	}
}

func TestBifrostClientCompleteRejectsMissingConfig(t *testing.T) {
	t.Parallel()

	client := &BifrostClient{}
	_, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "model"})
	if err == nil {
		t.Fatal("Complete() error = nil, want non-nil")
	}
}

func TestBifrostClientCompleteRejectsMissingProviderOrModel(t *testing.T) {
	t.Parallel()

	client := NewBifrostClient(&stubBifrostRequester{}, nil, nil, nil)

	cases := []CompleteRequest{{ProviderModelID: "model"}, {ProviderID: "infomaniak"}}
	for _, req := range cases {
		_, err := client.Complete(context.Background(), req)
		if err == nil {
			t.Fatalf("Complete(%#v) error = nil, want non-nil", req)
		}
	}
}

func TestNewConfiguredBifrostClientRequiresAccount(t *testing.T) {
	t.Parallel()

	_, err := NewConfiguredBifrostClient(nil, "", nil)
	if err == nil {
		t.Fatal("NewConfiguredBifrostClient(nil) error = nil, want non-nil")
	}
}

func TestParseBifrostLogLevelDefaultsToError(t *testing.T) {
	t.Parallel()

	if got := parseBifrostLogLevel("unknown"); got != schemas.LogLevelError {
		t.Fatalf("parseBifrostLogLevel(unknown) = %q, want %q", got, schemas.LogLevelError)
	}
	if got := parseBifrostLogLevel("debug"); got != schemas.LogLevelDebug {
		t.Fatalf("parseBifrostLogLevel(debug) = %q, want %q", got, schemas.LogLevelDebug)
	}
}

func stringPtr(v string) *string { return &v }
