package proxy

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/sashabaranov/go-openai"
)

func TestUpstreamTimeout(t *testing.T) {
	if got := upstreamTimeout(false); got != upstreamRequestTimeout {
		t.Fatalf("upstreamTimeout(false) = %v, want %v", got, upstreamRequestTimeout)
	}

	if got := upstreamTimeout(true); got != upstreamStreamTimeout {
		t.Fatalf("upstreamTimeout(true) = %v, want %v", got, upstreamStreamTimeout)
	}
}

func TestForwardOpenAIResponseTimesOut(t *testing.T) {
	originalRequestTimeout := upstreamRequestTimeout
	upstreamRequestTimeout = 10 * time.Millisecond
	defer func() {
		upstreamRequestTimeout = originalRequestTimeout
	}()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl-test","object":"chat.completion","created":1,"model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()

	config := openai.DefaultConfig("test-token")
	config.BaseURL = server.URL
	config.HTTPClient = server.Client()
	client := openai.NewClientWithConfig(config)

	ctx, cancel := withUpstreamTimeout(context.Background(), false)
	defer cancel()

	_, _, err := ForwardOpenAIResponse(
		ctx,
		openai.ChatCompletionRequest{
			Model: "gpt-4o",
			Messages: []openai.ChatCompletionMessage{{
				Role:    openai.ChatMessageRoleUser,
				Content: "hello",
			}},
		},
		client,
	)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("ForwardOpenAIResponse() error = %v, want context deadline exceeded", err)
	}
}
