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

	imageResp *schemas.BifrostImageGenerationResponse
	imageErr  *schemas.BifrostError
	imageReq  *schemas.BifrostImageGenerationRequest
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

func (s *stubBifrostRequester) ImageGenerationRequest(
	_ *schemas.BifrostContext,
	req *schemas.BifrostImageGenerationRequest,
) (*schemas.BifrostImageGenerationResponse, *schemas.BifrostError) {
	s.imageReq = req
	return s.imageResp, s.imageErr
}

type stubBifrostShutdowner struct{ called bool }

func (s *stubBifrostShutdowner) Shutdown() { s.called = true }

func TestBuildMessageContentTextOnly(t *testing.T) {
	t.Parallel()

	content := buildMessageContent("hello", nil, nil)
	if content.ContentStr == nil || *content.ContentStr != "hello" {
		t.Fatalf("text-only content = %+v, want ContentStr=hello", content)
	}
	if content.ContentBlocks != nil {
		t.Fatalf("text-only content should not use blocks")
	}
}

func TestBuildMessageContentWithImages(t *testing.T) {
	t.Parallel()

	content := buildMessageContent("describe this", []MessageImage{
		{Base64: "QUJD", MimeType: "image/png"},
	}, nil)
	if content.ContentStr != nil {
		t.Fatalf("multimodal content should not use ContentStr")
	}
	if len(content.ContentBlocks) != 2 {
		t.Fatalf("want 2 blocks (text+image), got %d", len(content.ContentBlocks))
	}
	if content.ContentBlocks[0].Type != schemas.ChatContentBlockTypeText ||
		content.ContentBlocks[0].Text == nil || *content.ContentBlocks[0].Text != "describe this" {
		t.Fatalf("first block should be the prompt text: %+v", content.ContentBlocks[0])
	}
	image := content.ContentBlocks[1]
	if image.Type != schemas.ChatContentBlockTypeImage || image.ImageURLStruct == nil {
		t.Fatalf("second block should be an image: %+v", image)
	}
	if image.ImageURLStruct.URL != "data:image/png;base64,QUJD" {
		t.Fatalf("image data URL = %q", image.ImageURLStruct.URL)
	}
}

func TestBuildMessageContentImageOnly(t *testing.T) {
	t.Parallel()

	content := buildMessageContent("", []MessageImage{{Base64: "QQ==", MimeType: "image/jpeg"}}, nil)
	if len(content.ContentBlocks) != 1 || content.ContentBlocks[0].Type != schemas.ChatContentBlockTypeImage {
		t.Fatalf("image-only content should be a single image block: %+v", content.ContentBlocks)
	}
}

func TestBuildMessageContentWithFile(t *testing.T) {
	t.Parallel()

	content := buildMessageContent("summarise", nil, []MessageFile{
		{Base64: "JVBERi0=", MimeType: "application/pdf", Filename: "report.pdf"},
	})
	if content.ContentStr != nil {
		t.Fatalf("file content should not use ContentStr")
	}
	if len(content.ContentBlocks) != 2 {
		t.Fatalf("want 2 blocks (text+file), got %d", len(content.ContentBlocks))
	}
	file := content.ContentBlocks[1]
	if file.Type != schemas.ChatContentBlockTypeFile || file.File == nil {
		t.Fatalf("second block should be a file: %+v", file)
	}
	if file.File.FileData == nil || *file.File.FileData != "data:application/pdf;base64,JVBERi0=" {
		t.Fatalf("file data URL = %v", file.File.FileData)
	}
	if file.File.Filename == nil || *file.File.Filename != "report.pdf" {
		t.Fatalf("file name = %v", file.File.Filename)
	}
}

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

func TestBifrostClientCompleteMapsReasoning(t *testing.T) {
	t.Parallel()

	reasoning := "First I weigh the constraints, then I answer."
	requester := &stubBifrostRequester{
		resp: &schemas.BifrostChatResponse{
			Choices: []schemas.BifrostResponseChoice{{
				ChatNonStreamResponseChoice: &schemas.ChatNonStreamResponseChoice{
					Message: &schemas.ChatMessage{
						Role: schemas.ChatMessageRoleAssistant,
						Content: &schemas.ChatMessageContent{
							ContentStr: stringPtr("The answer is 42."),
						},
						ChatAssistantMessage: &schemas.ChatAssistantMessage{
							Reasoning: stringPtr(reasoning),
						},
					},
				},
			}},
			Usage: &schemas.BifrostLLMUsage{
				PromptTokens:     10,
				CompletionTokens: 20,
				TotalTokens:      30,
				CompletionTokensDetails: &schemas.ChatCompletionTokensDetails{
					ReasoningTokens: 8,
				},
			},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	got, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "requesty", ProviderModelID: "model"})
	if err != nil {
		t.Fatalf("Complete() error = %v, want nil", err)
	}
	if got.Message.Content != "The answer is 42." {
		t.Fatalf("Complete() content = %q, want %q", got.Message.Content, "The answer is 42.")
	}
	if got.Reasoning != reasoning {
		t.Fatalf("Complete() reasoning = %q, want %q", got.Reasoning, reasoning)
	}
	if got.Usage.ReasoningTokens != 8 {
		t.Fatalf("Complete() reasoning tokens = %d, want 8", got.Usage.ReasoningTokens)
	}
}

func TestBifrostClientBuildsReasoningEffortParam(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		effort     string
		wantNil    bool
		wantEffort *string
	}{
		{name: "empty sends no reasoning param", effort: "", wantNil: true},
		{name: "off disables via none", effort: "off", wantEffort: stringPtr("none")},
		{name: "none disables reasoning", effort: "none", wantEffort: stringPtr("none")},
		{name: "medium passes through as effort", effort: "medium", wantEffort: stringPtr("medium")},
		{name: "model-specific tier passes through", effort: "ultra", wantEffort: stringPtr("ultra")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			requester := &stubBifrostRequester{
				resp: &schemas.BifrostChatResponse{
					Choices: []schemas.BifrostResponseChoice{{
						ChatNonStreamResponseChoice: &schemas.ChatNonStreamResponseChoice{
							Message: &schemas.ChatMessage{
								Role:    schemas.ChatMessageRoleAssistant,
								Content: &schemas.ChatMessageContent{ContentStr: stringPtr("hi")},
							},
						},
					}},
				},
			}
			client := NewBifrostClient(requester, nil, nil, nil)
			if _, err := client.Complete(context.Background(), CompleteRequest{
				ProviderID:      "requesty",
				ProviderModelID: "model",
				ReasoningEffort: tc.effort,
			}); err != nil {
				t.Fatalf("Complete() error = %v", err)
			}

			reasoning := (*schemas.ChatReasoning)(nil)
			if requester.req.Params != nil {
				reasoning = requester.req.Params.Reasoning
			}
			if tc.wantNil {
				if reasoning != nil {
					t.Fatalf("reasoning param = %#v, want nil", reasoning)
				}
				return
			}
			if reasoning == nil {
				t.Fatalf("reasoning param = nil, want set")
			}
			if tc.wantEffort != nil {
				if reasoning.Effort == nil || *reasoning.Effort != *tc.wantEffort {
					t.Fatalf("reasoning.Effort = %#v, want %q", reasoning.Effort, *tc.wantEffort)
				}
			}
		})
	}
}

func TestBifrostClientCompleteOmitsReasoningWhenAbsent(t *testing.T) {
	t.Parallel()

	requester := &stubBifrostRequester{
		resp: &schemas.BifrostChatResponse{
			Choices: []schemas.BifrostResponseChoice{{
				ChatNonStreamResponseChoice: &schemas.ChatNonStreamResponseChoice{
					Message: &schemas.ChatMessage{
						Role:    schemas.ChatMessageRoleAssistant,
						Content: &schemas.ChatMessageContent{ContentStr: stringPtr("Hi")},
					},
				},
			}},
		},
	}
	client := NewBifrostClient(requester, nil, nil, nil)

	got, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "requesty", ProviderModelID: "model"})
	if err != nil {
		t.Fatalf("Complete() error = %v, want nil", err)
	}
	if got.Reasoning != "" {
		t.Fatalf("Complete() reasoning = %q, want empty", got.Reasoning)
	}
	if got.Usage.ReasoningTokens != 0 {
		t.Fatalf("Complete() reasoning tokens = %d, want 0", got.Usage.ReasoningTokens)
	}
}

func TestBifrostClientCompleteStreamSeparatesReasoningDeltas(t *testing.T) {
	t.Parallel()

	stream := make(chan *schemas.BifrostStreamChunk, 3)
	stream <- streamChunk(stringPtr("Let me "), nil)
	stream <- streamChunk(nil, stringPtr("think about this"))
	stream <- streamChunk(stringPtr("Answer"), nil)
	close(stream)

	requester := &stubBifrostRequester{stream: stream}
	client := NewBifrostClient(requester, nil, nil, nil)

	out, err := client.CompleteStream(context.Background(), CompleteRequest{ProviderID: "requesty", ProviderModelID: "model"})
	if err != nil {
		t.Fatalf("CompleteStream() error = %v, want nil", err)
	}

	var answer, reasoning strings.Builder
	for event := range out {
		if event.Err != nil {
			t.Fatalf("stream event error = %v", event.Err)
		}
		answer.WriteString(event.Delta)
		reasoning.WriteString(event.ReasoningDelta)
	}

	if answer.String() != "Let me Answer" {
		t.Fatalf("answer = %q, want %q", answer.String(), "Let me Answer")
	}
	if reasoning.String() != "think about this" {
		t.Fatalf("reasoning = %q, want %q", reasoning.String(), "think about this")
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

// streamChunk builds a single streaming chunk carrying an optional answer delta
// and/or reasoning delta, mirroring how providers interleave the two.
func streamChunk(content, reasoning *string) *schemas.BifrostStreamChunk {
	return &schemas.BifrostStreamChunk{
		BifrostChatResponse: &schemas.BifrostChatResponse{
			Choices: []schemas.BifrostResponseChoice{{
				ChatStreamResponseChoice: &schemas.ChatStreamResponseChoice{
					Delta: &schemas.ChatStreamResponseChoiceDelta{
						Content:   content,
						Reasoning: reasoning,
					},
				},
			}},
		},
	}
}
