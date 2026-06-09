package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSelectReplySwitchesOnTokenCap(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		req  chatCompletionRequest
		want string
	}{
		{
			name: "tiny max_tokens triggers the conversation-title path",
			req:  chatCompletionRequest{MaxTokens: 10},
			want: "Mocked conversation title",
		},
		{
			name: "max_tokens at the 20-token cliff still gets the title reply",
			req:  chatCompletionRequest{MaxTokens: 20},
			want: "Mocked conversation title",
		},
		{
			name: "max_tokens above 20 returns a normal assistant reply",
			req:  chatCompletionRequest{MaxTokens: 21},
			want: "Mocked assistant reply",
		},
		{
			name: "max_completion_tokens is honoured when max_tokens is unset",
			req:  chatCompletionRequest{MaxCompletionTokens: 15},
			want: "Mocked conversation title",
		},
		{
			name: "max_tokens takes precedence over max_completion_tokens",
			req:  chatCompletionRequest{MaxTokens: 100, MaxCompletionTokens: 10},
			want: "Mocked assistant reply",
		},
		{
			name: "no token cap defaults to the assistant reply",
			req:  chatCompletionRequest{},
			want: "Mocked assistant reply",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := selectReply(tc.req); got != tc.want {
				t.Fatalf("selectReply(%+v) = %q, want %q", tc.req, got, tc.want)
			}
		})
	}
}

func TestRoutesHealthAndCompletionsContract(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := routes(logger)

	t.Run("GET /health returns 200 with {ok:true}", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var body map[string]bool
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if !body["ok"] {
			t.Fatalf("body = %v, want {ok:true}", body)
		}
	})

	t.Run("POST /v1/chat/completions returns the OpenAI shape", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(
			http.MethodPost,
			"/v1/chat/completions",
			strings.NewReader(`{"model":"infomaniak:llama-3","max_tokens":256}`),
		)
		req.Header.Set("content-type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		var body chatCompletionResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if body.ID != "chatcmpl-mock" {
			t.Fatalf("id = %q, want chatcmpl-mock", body.ID)
		}
		if body.Model != "infomaniak:llama-3" {
			t.Fatalf("model = %q, want echo of request", body.Model)
		}
		if len(body.Choices) != 1 || body.Choices[0].Message.Content != "Mocked assistant reply" {
			t.Fatalf("unexpected choices: %+v", body.Choices)
		}
	})

	t.Run("POST /v1/chat/completions with no body still answers 200", func(t *testing.T) {
		// The .mjs path is forgiving — accept an empty body, default the
		// model, default the reply. Useful for ad-hoc curl smoke tests.
		t.Parallel()
		req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(nil))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("unknown route returns 404", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodGet, "/nope", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
	})

	t.Run("malformed JSON returns 400", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(
			http.MethodPost,
			"/v1/chat/completions",
			strings.NewReader(`{not json`),
		)
		req.Header.Set("content-type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})
}
