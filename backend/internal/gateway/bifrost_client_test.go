package gateway

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

type stubBifrostRequester struct {
	resp *schemas.BifrostChatResponse
	err  *schemas.BifrostError
	req  *schemas.BifrostChatRequest
}

func (s *stubBifrostRequester) ChatCompletionRequest(
	_ *schemas.BifrostContext,
	req *schemas.BifrostChatRequest,
) (*schemas.BifrostChatResponse, *schemas.BifrostError) {
	s.req = req
	return s.resp, s.err
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
	client := NewBifrostClient(requester, shutdowner, nil)

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

	client := NewBifrostClient(requester, nil, nil)
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

	requester := &stubBifrostRequester{
		err: &schemas.BifrostError{Error: &schemas.ErrorField{Message: "provider unavailable"}},
	}
	client := NewBifrostClient(requester, nil, nil)

	_, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "infomaniak", ProviderModelID: "model"})
	if err == nil || err.Error() != "bifrost request failed: provider unavailable" {
		t.Fatalf("Complete() error = %v, want provider unavailable", err)
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

	client := NewBifrostClient(&stubBifrostRequester{}, nil, nil)

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

	_, err := NewConfiguredBifrostClient(nil)
	if err == nil {
		t.Fatal("NewConfiguredBifrostClient(nil) error = nil, want non-nil")
	}
}

func stringPtr(v string) *string { return &v }
