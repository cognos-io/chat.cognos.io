package main

import (
	"bytes"
	"encoding/base64"
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
		{
			name: "echo sentinel replies with the user content verbatim, stripped",
			req: chatCompletionRequest{
				Messages: []chatCompletionMsg{
					{Role: "user", Content: echoPrefix + "hello world"},
				},
			},
			want: "hello world",
		},
		{
			name: "echo uses the latest user turn, ignoring earlier ones",
			req: chatCompletionRequest{
				Messages: []chatCompletionMsg{
					{Role: "user", Content: "first"},
					{Role: "assistant", Content: "reply"},
					{Role: "user", Content: echoPrefix + "second"},
				},
			},
			want: "second",
		},
		{
			name: "echo sentinel is ignored under the title token cap",
			req: chatCompletionRequest{
				MaxTokens: 10,
				Messages: []chatCompletionMsg{
					{Role: "user", Content: echoPrefix + "ignored"},
				},
			},
			want: "Mocked conversation title",
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

	t.Run("[reason] sentinel adds reasoning + reasoning_tokens, plain requests omit them", func(t *testing.T) {
		t.Parallel()

		// A [reason] request opts into reasoning emission.
		req := httptest.NewRequest(
			http.MethodPost,
			"/v1/chat/completions",
			strings.NewReader(`{"model":"m","max_tokens":256,"messages":[{"role":"user","content":"[reason]why?"}]}`),
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
		if body.Choices[0].Message.Reasoning != reasoningTrace {
			t.Fatalf("reasoning = %q, want %q", body.Choices[0].Message.Reasoning, reasoningTrace)
		}
		if body.Usage.CompletionTokensDetails == nil ||
			body.Usage.CompletionTokensDetails.ReasoningTokens != reasoningTokenCount {
			t.Fatalf("reasoning tokens = %+v, want %d", body.Usage.CompletionTokensDetails, reasoningTokenCount)
		}

		// A plain request emits no reasoning at all.
		plain := httptest.NewRequest(
			http.MethodPost,
			"/v1/chat/completions",
			strings.NewReader(`{"model":"m","max_tokens":256,"messages":[{"role":"user","content":"why?"}]}`),
		)
		plain.Header.Set("content-type", "application/json")
		plainRec := httptest.NewRecorder()
		handler.ServeHTTP(plainRec, plain)
		var plainBody chatCompletionResponse
		if err := json.Unmarshal(plainRec.Body.Bytes(), &plainBody); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if plainBody.Choices[0].Message.Reasoning != "" {
			t.Fatalf("plain reasoning = %q, want empty", plainBody.Choices[0].Message.Reasoning)
		}
		if plainBody.Usage.CompletionTokensDetails != nil {
			t.Fatalf("plain reasoning tokens = %+v, want nil", plainBody.Usage.CompletionTokensDetails)
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

func TestRoutesImageGenerationContract(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := routes(logger)

	t.Run("POST /v1/images/generations returns decodable b64_json", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(
			http.MethodPost,
			"/v1/images/generations",
			strings.NewReader(`{"model":"azure/openai/gpt-image-1","prompt":"a fox","response_format":"b64_json","n":1}`),
		)
		req.Header.Set("content-type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}

		var body imageGenerationResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(body.Data) != 1 || body.Data[0].B64JSON == "" {
			t.Fatalf("expected one inline image, got %+v", body.Data)
		}
		if _, err := base64.StdEncoding.DecodeString(body.Data[0].B64JSON); err != nil {
			t.Fatalf("b64_json is not valid base64: %v", err)
		}
		// Images API reports tokens, never cost (mirrors real Requesty).
		if body.Usage == nil || body.Usage.OutputTokens == 0 {
			t.Fatalf("expected token usage, got %+v", body.Usage)
		}
	})

	t.Run("POST /v1/chat/completions for an image model returns message.images data URI", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(
			http.MethodPost,
			"/v1/chat/completions",
			strings.NewReader(`{"model":"vertex/gemini-2.5-flash-image","messages":[{"role":"user","content":"a fox"}]}`),
		)
		req.Header.Set("content-type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}

		var body chatImageResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(body.Choices) != 1 || len(body.Choices[0].Message.Images) != 1 {
			t.Fatalf("expected one inline image, got %+v", body.Choices)
		}
		url := body.Choices[0].Message.Images[0].ImageURL.URL
		if !strings.HasPrefix(url, "data:image/png;base64,") {
			t.Fatalf("expected a png data URI, got %q", url[:min(40, len(url))])
		}
		if _, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(url, "data:image/png;base64,")); err != nil {
			t.Fatalf("data URI payload is not valid base64: %v", err)
		}
		// The chat transport reports cost at usage.cost.
		if body.Usage.Cost == 0 {
			t.Fatalf("expected a non-zero usage.cost, got %+v", body.Usage)
		}
	})
}
