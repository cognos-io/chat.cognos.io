package gateway

import (
	"context"
	"errors"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/pkg/proxy"
	"github.com/pocketbase/pocketbase/core"
	oai "github.com/sashabaranov/go-openai"
)

type stubUpstreamRepo struct {
	provider string
	upstream proxy.Upstream
	err      error
}

func (r stubUpstreamRepo) Provider(provider string) (proxy.Upstream, error) {
	r.provider = provider
	if r.err != nil {
		return nil, r.err
	}
	return r.upstream, nil
}

type stubUpstream struct {
	chatCompletion func(*core.RequestEvent, oai.ChatCompletionRequest) (oai.ChatCompletionResponse, string, error)
}

func (u stubUpstream) LookupModel(internalModel string) (string, error) {
	return internalModel, nil
}

func (u stubUpstream) EnsureNoRetention() error {
	return nil
}

func (u stubUpstream) ChatCompletion(
	e *core.RequestEvent,
	req oai.ChatCompletionRequest,
) (oai.ChatCompletionResponse, string, error) {
	if u.chatCompletion != nil {
		return u.chatCompletion(e, req)
	}
	return oai.ChatCompletionResponse{}, "", nil
}

func TestLegacyClientCompleteRequiresUpstreamRepo(t *testing.T) {
	t.Parallel()

	client := &LegacyClient{}

	_, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "infomaniak"})
	if err == nil {
		t.Fatal("Complete() error = nil, want non-nil")
	}
}

func TestLegacyClientCompleteReturnsProviderLookupError(t *testing.T) {
	t.Parallel()

	wantErr := errors.New("provider unavailable")
	client := NewLegacyClient(stubUpstreamRepo{err: wantErr})

	_, err := client.Complete(context.Background(), CompleteRequest{ProviderID: "infomaniak"})
	if !errors.Is(err, wantErr) {
		t.Fatalf("Complete() error = %v, want %v", err, wantErr)
	}
}

func TestLegacyClientCompleteMapsRequestAndResponse(t *testing.T) {
	t.Parallel()

	ctxKey := struct{}{}
	ctxValue := "trace-123"
	providerCostUSD := 0.99 // only used to prove legacy client does not fabricate it
	_ = providerCostUSD

	client := NewLegacyClient(stubUpstreamRepo{
		upstream: stubUpstream{
			chatCompletion: func(e *core.RequestEvent, req oai.ChatCompletionRequest) (oai.ChatCompletionResponse, string, error) {
				if got := e.Request.Context().Value(ctxKey); got != ctxValue {
					t.Fatalf("Request.Context().Value(ctxKey) = %v, want %v", got, ctxValue)
				}
				if req.Model != "llama-3.3-70b-instruct" {
					t.Fatalf("ChatCompletion() Model = %q, want %q", req.Model, "llama-3.3-70b-instruct")
				}
				if req.MaxTokens != 512 {
					t.Fatalf("ChatCompletion() MaxTokens = %d, want %d", req.MaxTokens, 512)
				}
				if len(req.Messages) != 2 {
					t.Fatalf("ChatCompletion() len(Messages) = %d, want %d", len(req.Messages), 2)
				}
				if req.Messages[0].Role != "system" || req.Messages[0].Content != "You are helpful." {
					t.Fatalf("ChatCompletion() Messages[0] = %#v, want system helpful prompt", req.Messages[0])
				}
				if req.Messages[1].Role != "user" || req.Messages[1].Content != "Hello" || req.Messages[1].Name != "ewan" {
					t.Fatalf("ChatCompletion() Messages[1] = %#v, want user message", req.Messages[1])
				}

				return oai.ChatCompletionResponse{
					Usage: oai.Usage{PromptTokens: 120, CompletionTokens: 45, TotalTokens: 165},
				}, "Hi there", nil
			},
		},
	})

	got, err := client.Complete(
		context.WithValue(context.Background(), ctxKey, ctxValue),
		CompleteRequest{
			ProviderID:      "infomaniak",
			ProviderModelID: "llama-3.3-70b-instruct",
			Messages: []Message{
				{Role: "system", Content: "You are helpful."},
				{Role: "user", Content: "Hello", Name: "ewan"},
			},
			MaxOutputTokens: 512,
		},
	)
	if err != nil {
		t.Fatalf("Complete() error = %v, want nil", err)
	}
	if got.Message.Role != "assistant" {
		t.Fatalf("Complete() Message.Role = %q, want %q", got.Message.Role, "assistant")
	}
	if got.Message.Content != "Hi there" {
		t.Fatalf("Complete() Message.Content = %q, want %q", got.Message.Content, "Hi there")
	}
	if got.Usage.InputTokens != 120 {
		t.Fatalf("Complete() Usage.InputTokens = %d, want %d", got.Usage.InputTokens, 120)
	}
	if got.Usage.OutputTokens != 45 {
		t.Fatalf("Complete() Usage.OutputTokens = %d, want %d", got.Usage.OutputTokens, 45)
	}
	if got.Usage.TotalTokens != 165 {
		t.Fatalf("Complete() Usage.TotalTokens = %d, want %d", got.Usage.TotalTokens, 165)
	}
	if got.Usage.ProviderCostUSD != nil {
		t.Fatal("Complete() Usage.ProviderCostUSD = non-nil, want nil")
	}
}
