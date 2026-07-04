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
			name: "a compaction system prompt returns a parseable compaction block",
			req: chatCompletionRequest{
				MaxTokens: 2000,
				Messages: []chatCompletionMsg{
					{Role: "system", Content: "You compact a conversation so it can continue."},
					{Role: "user", Content: "[M1] user: hi"},
				},
			},
			want: mockCompactionReply,
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

func postResponses(t *testing.T, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	routes(slog.New(slog.NewTextHandler(io.Discard, nil))).ServeHTTP(rec, req)
	return rec
}

func parseResponsesStream(t *testing.T, rec *httptest.ResponseRecorder) []responsesStreamEvent {
	t.Helper()
	var events []responsesStreamEvent
	for _, raw := range strings.Split(rec.Body.String(), "\n") {
		if !strings.HasPrefix(raw, "data: ") {
			continue
		}
		data := strings.TrimPrefix(raw, "data: ")
		if data == "[DONE]" {
			continue
		}
		var ev responsesStreamEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			t.Fatalf("unmarshal event %q: %v", data, err)
		}
		events = append(events, ev)
	}
	return events
}

func TestResponsesContentText(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		raw  string
		want string
	}{
		{name: "plain string", raw: `"hello"`, want: "hello"},
		{name: "input_text blocks", raw: `[{"type":"input_text","text":"a"},{"type":"input_text","text":"b"}]`, want: "ab"},
		{name: "empty", raw: ``, want: ""},
		{name: "unknown shape ignored", raw: `{"foo":1}`, want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := responsesContentText(json.RawMessage(tc.raw))
			if got != tc.want {
				t.Fatalf("responsesContentText(%s) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

func TestResponsesStreamBasicReply(t *testing.T) {
	t.Parallel()

	rec := postResponses(t, map[string]any{
		"model":  "eu-model",
		"stream": true,
		"input":  []map[string]any{{"role": "user", "content": "hi"}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	events := parseResponsesStream(t, rec)

	var text strings.Builder
	sawCompleted := false
	for _, ev := range events {
		if ev.Type == "response.output_text.delta" && ev.Annotation == nil {
			text.WriteString(ev.Delta)
		}
		if ev.Type == "response.completed" {
			sawCompleted = true
			if ev.Response == nil || ev.Response.Usage == nil {
				t.Fatalf("completed event missing usage: %+v", ev)
			}
			if ev.Response.Usage.Cost != nil {
				t.Fatalf("default stream should report no cost, got %v", *ev.Response.Usage.Cost)
			}
		}
	}
	if text.String() != "Mocked assistant reply" {
		t.Fatalf("reply = %q, want %q", text.String(), "Mocked assistant reply")
	}
	if !sawCompleted {
		t.Fatal("no response.completed event")
	}
}

func TestResponsesStreamWebSearch(t *testing.T) {
	t.Parallel()

	rec := postResponses(t, map[string]any{
		"model":  "eu-model",
		"stream": true,
		"input":  []map[string]any{{"role": "user", "content": "what is the minimum wage"}},
		"tools":  []map[string]any{{"type": "web_search"}},
	})
	events := parseResponsesStream(t, rec)

	var text strings.Builder
	var annotation *responsesAnnotation
	sawSearchCompleted := false
	var sources []responsesSource
	for _, ev := range events {
		if ev.Type == "response.output_text.delta" && ev.Annotation == nil {
			text.WriteString(ev.Delta)
		}
		if ev.Annotation != nil {
			annotation = ev.Annotation
		}
		if ev.Type == "response.web_search_call.completed" {
			sawSearchCompleted = true
		}
		if ev.Type == "response.output_item.done" && ev.Item != nil && ev.Item.Type == "web_search_call" && ev.Item.Action != nil {
			sources = ev.Item.Action.Sources
		}
	}

	if text.String() != webSearchReply {
		t.Fatalf("reply = %q, want the accented web-search reply", text.String())
	}
	if annotation == nil {
		t.Fatal("no url_citation annotation on the stream")
	}
	if annotation.URL != mockCitationURL || annotation.Title != mockCitationTitle {
		t.Fatalf("annotation = %+v, want the citation fixture", annotation)
	}
	// Offsets are UTF-8 byte offsets into the reply.
	wantStart := strings.Index(webSearchReply, webSearchAnchor)
	wantEnd := wantStart + len(webSearchAnchor)
	if annotation.StartIndex != wantStart || annotation.EndIndex != wantEnd {
		t.Fatalf("annotation offsets = [%d,%d], want byte offsets [%d,%d]", annotation.StartIndex, annotation.EndIndex, wantStart, wantEnd)
	}
	if !sawSearchCompleted {
		t.Fatal("no web_search_call.completed activity event")
	}
	if len(sources) != 1 || sources[0].URL != mockSourceProxyURL || sources[0].Title != "" {
		t.Fatalf("action sources = %+v, want a single title-less proxy source", sources)
	}
}

func TestResponsesStreamCostSentinel(t *testing.T) {
	t.Parallel()

	rec := postResponses(t, map[string]any{
		"model":  "eu-model",
		"stream": true,
		"input":  []map[string]any{{"role": "user", "content": costSentinel + " price it"}},
	})
	events := parseResponsesStream(t, rec)

	for _, ev := range events {
		if ev.Type == "response.completed" {
			if ev.Response == nil || ev.Response.Usage == nil || ev.Response.Usage.Cost == nil {
				t.Fatalf("expected a provider cost under the [cost] sentinel: %+v", ev)
			}
			if *ev.Response.Usage.Cost != mockProviderCostUSD {
				t.Fatalf("cost = %v, want %v", *ev.Response.Usage.Cost, mockProviderCostUSD)
			}
			return
		}
	}
	t.Fatal("no response.completed event")
}

func TestResponsesStreamReasoning(t *testing.T) {
	t.Parallel()

	rec := postResponses(t, map[string]any{
		"model":  "eu-model",
		"stream": true,
		"input":  []map[string]any{{"role": "user", "content": reasonPrefix + " explain"}},
	})
	events := parseResponsesStream(t, rec)

	sawReasoning := false
	for _, ev := range events {
		if ev.Type == "response.reasoning_summary_text.delta" && ev.Delta == reasoningTrace {
			sawReasoning = true
		}
		if ev.Type == "response.completed" {
			if ev.Response == nil || ev.Response.Usage == nil || ev.Response.Usage.OutputTokensDetails == nil ||
				ev.Response.Usage.OutputTokensDetails.ReasoningTokens != reasoningTokenCount {
				t.Fatalf("expected reasoning_tokens=%d in usage: %+v", reasoningTokenCount, ev)
			}
		}
	}
	if !sawReasoning {
		t.Fatal("no reasoning_summary_text.delta with the canned trace")
	}
}

func TestResponsesNonStreamReply(t *testing.T) {
	t.Parallel()

	rec := postResponses(t, map[string]any{
		"model":  "eu-model",
		"stream": false,
		"input":  []map[string]any{{"role": "user", "content": "hi"}},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp responsesObject
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Status != "completed" || len(resp.Output) == 0 {
		t.Fatalf("response = %+v, want a completed output", resp)
	}
	if resp.Output[0].Content[0].Text != "Mocked assistant reply" {
		t.Fatalf("content = %q, want the assistant reply", resp.Output[0].Content[0].Text)
	}
	if resp.Usage == nil || resp.Usage.Cost != nil {
		t.Fatalf("usage = %+v, want tokens and no default cost", resp.Usage)
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
