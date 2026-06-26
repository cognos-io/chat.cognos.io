// mock-ai-provider is the OpenAI-shaped completions stub used by the e2e
// suite and by `just dev` so completion requests don't need a real upstream.
//
// The e2e harness points COGNOS_INFOMANIAK_URL here explicitly for the backend
// process it launches. The reply is deterministic and intentionally short —
// the goal is to pin the HTTP contract between the backend gateway and the
// upstream, not to imitate LLM output.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if err := run(ctx, os.Getenv, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, getenv func(string) string, logSink io.Writer) error {
	logger := slog.New(slog.NewTextHandler(logSink, &slog.HandlerOptions{Level: slog.LevelInfo}))

	port := 18080
	if raw := getenv("E2E_AI_MOCK_PORT"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			return fmt.Errorf("invalid E2E_AI_MOCK_PORT %q: %w", raw, err)
		}
		port = parsed
	}

	server := &http.Server{
		Addr:              net.JoinHostPort("127.0.0.1", strconv.Itoa(port)),
		Handler:           routes(logger),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("mock ai provider listening", "addr", server.Addr)
		if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		return server.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}

func routes(logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /v1/chat/completions", chatCompletionsHandler(logger))
	mux.HandleFunc("POST /v1/images/generations", imagesGenerationHandler(logger))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		logger.Info("not found", "method", r.Method, "path", r.URL.Path)
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	})
	return mux
}

type chatCompletionRequest struct {
	Model               string              `json:"model"`
	MaxTokens           int                 `json:"max_tokens"`
	MaxCompletionTokens int                 `json:"max_completion_tokens"`
	Messages            []chatCompletionMsg `json:"messages"`
	Stream              bool                `json:"stream"`
}

type chatCompletionResponse struct {
	ID      string                 `json:"id"`
	Object  string                 `json:"object"`
	Created int64                  `json:"created"`
	Model   string                 `json:"model"`
	Choices []chatCompletionChoice `json:"choices"`
	Usage   chatCompletionUsage    `json:"usage"`
}

type chatCompletionChoice struct {
	Index        int               `json:"index"`
	Message      chatCompletionMsg `json:"message"`
	FinishReason string            `json:"finish_reason"`
}

type chatCompletionMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	// Reasoning carries provider reasoning text (OpenAI/OpenRouter "reasoning"
	// field). Emitted only for [reason]-sentinel requests; omitted otherwise.
	Reasoning string `json:"reasoning,omitempty"`
}

type chatCompletionUsage struct {
	PromptTokens            int                      `json:"prompt_tokens"`
	CompletionTokens        int                      `json:"completion_tokens"`
	TotalTokens             int                      `json:"total_tokens"`
	CompletionTokensDetails *completionTokensDetails `json:"completion_tokens_details,omitempty"`
}

type completionTokensDetails struct {
	ReasoningTokens int `json:"reasoning_tokens,omitempty"`
}

// Streaming (SSE) response shapes — OpenAI `chat.completion.chunk` objects.
// The backend gateway (bifrost) requests a stream and reconstructs the reply
// from the delta chunks plus a trailing usage chunk.
type chatCompletionChunk struct {
	ID      string                      `json:"id"`
	Object  string                      `json:"object"`
	Created int64                       `json:"created"`
	Model   string                      `json:"model"`
	Choices []chatCompletionChunkChoice `json:"choices"`
	Usage   *chatCompletionUsage        `json:"usage,omitempty"`
}

type chatCompletionChunkChoice struct {
	Index        int                    `json:"index"`
	Delta        chatCompletionChunkMsg `json:"delta"`
	FinishReason *string                `json:"finish_reason"`
}

type chatCompletionChunkMsg struct {
	Role      string `json:"role,omitempty"`
	Content   string `json:"content,omitempty"`
	Reasoning string `json:"reasoning,omitempty"`
}

func chatCompletionsHandler(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req chatCompletionRequest
		if r.ContentLength != 0 {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				logger.Warn("decode failed", "err", err)
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
				return
			}
		}

		model := req.Model
		if model == "" {
			model = "mock-model"
		}

		// Image models (Gemini-style) return the generated image inline on the
		// chat completion. Our gateway calls this path non-streaming with the raw
		// response enabled, then reads choices[].message.images[].
		if isImageModel(model) {
			logger.Info("chat image completion", "model", model)
			writeChatImageResponse(w, model)
			return
		}

		reply := selectReply(req)
		reasoning := mockReasoning(req)

		logger.Info("chat completion", "model", model, "reply", reply, "stream", req.Stream)

		if req.Stream {
			writeChatCompletionStream(w, logger, model, reply, reasoning)
			return
		}

		usage := chatCompletionUsage{PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2}
		if reasoning != "" {
			usage.CompletionTokensDetails = &completionTokensDetails{ReasoningTokens: reasoningTokenCount}
		}

		writeJSON(w, http.StatusOK, chatCompletionResponse{
			ID:      "chatcmpl-mock",
			Object:  "chat.completion",
			Created: time.Now().Unix(),
			Model:   model,
			Choices: []chatCompletionChoice{{
				Index:        0,
				Message:      chatCompletionMsg{Role: "assistant", Content: reply, Reasoning: reasoning},
				FinishReason: "stop",
			}},
			Usage: usage,
		})
	}
}

// writeChatCompletionStream emits an OpenAI-style SSE stream: a content delta
// chunk, a final chunk with finish_reason, a usage chunk, then `[DONE]`. The
// whole reply goes in a single delta — bifrost accumulates deltas, so chunking
// finer buys nothing for the mock.
func writeChatCompletionStream(w http.ResponseWriter, logger *slog.Logger, model, reply, reasoning string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		logger.Error("streaming unsupported: ResponseWriter is not a Flusher")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming unsupported"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	created := time.Now().Unix()
	stop := "stop"

	send := func(chunk chatCompletionChunk) {
		payload, _ := json.Marshal(chunk)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
		flusher.Flush()
	}

	// Reasoning delta first (on its own field), when this request opted in.
	if reasoning != "" {
		send(chatCompletionChunk{
			ID:      "chatcmpl-mock",
			Object:  "chat.completion.chunk",
			Created: created,
			Model:   model,
			Choices: []chatCompletionChunkChoice{{
				Index: 0,
				Delta: chatCompletionChunkMsg{Role: "assistant", Reasoning: reasoning},
			}},
		})
	}

	// Content delta.
	send(chatCompletionChunk{
		ID:      "chatcmpl-mock",
		Object:  "chat.completion.chunk",
		Created: created,
		Model:   model,
		Choices: []chatCompletionChunkChoice{{
			Index: 0,
			Delta: chatCompletionChunkMsg{Role: "assistant", Content: reply},
		}},
	})

	// Final chunk: finish_reason + usage (OpenAI sends usage in a trailing chunk).
	usage := &chatCompletionUsage{PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2}
	if reasoning != "" {
		usage.CompletionTokensDetails = &completionTokensDetails{ReasoningTokens: reasoningTokenCount}
	}
	send(chatCompletionChunk{
		ID:      "chatcmpl-mock",
		Object:  "chat.completion.chunk",
		Created: created,
		Model:   model,
		Choices: []chatCompletionChunkChoice{{
			Index:        0,
			Delta:        chatCompletionChunkMsg{},
			FinishReason: &stop,
		}},
		Usage: usage,
	})

	_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	flusher.Flush()
}

// echoPrefix opts a request into echo mode: the latest user turn is replied to
// verbatim with the sentinel stripped. Tests use it to drive an arbitrarily
// large assistant reply (to exercise message-persistence limits) without baking
// sizes into the mock.
const echoPrefix = "[echo]"

// reasonPrefix opts a request into reasoning mode: the mock returns a fixed
// reasoning trace (text + reasoning_tokens) alongside the normal reply, so the
// gateway → handler reasoning path can be exercised end-to-end. The sentinel is
// not stripped from the reply — it only toggles reasoning emission.
const reasonPrefix = "[reason]"

// reasoningTrace and reasoningTokenCount are the canned reasoning artefacts the
// mock emits for [reason] requests; tests assert on these exact values.
const reasoningTrace = "Mock reasoning trace"
const reasoningTokenCount = 7

// mockReasoning returns the canned reasoning trace when the latest user turn
// opts in via the [reason] sentinel, or "" otherwise.
func mockReasoning(req chatCompletionRequest) string {
	if strings.HasPrefix(lastUserContent(req), reasonPrefix) {
		return reasoningTrace
	}
	return ""
}

// compactionSystemMarker is a stable phrase from the backend-owned compaction
// system prompt. The mock keys off it to return a parseable <compaction> block
// instead of a normal assistant turn, so the compaction endpoint can be driven
// end-to-end without a real model.
const compactionSystemMarker = "You compact a conversation"

// mockCompactionReply is a deterministic, parseable compaction payload. It cites
// alias M1 (always present in the e2e input) so citation resolution is
// exercised, and embeds a recognisable plaintext the suite asserts never leaks
// into the stored ciphertext.
const mockCompactionReply = "<compaction>\n" +
	`{"durable_memory":{"items":["MOCK_COMPACTION_FACT about the user [M1]"]},"rolling_narrative":"MOCK_COMPACTION_NARRATIVE","citations":["M1"]}` +
	"\n</compaction>"

// isCompactionRequest reports whether the request carries the compaction system
// prompt.
func isCompactionRequest(req chatCompletionRequest) bool {
	for _, m := range req.Messages {
		if m.Role == "system" && strings.Contains(m.Content, compactionSystemMarker) {
			return true
		}
	}
	return false
}

// selectReply mirrors the .mjs heuristic: the backend issues a tiny
// (max_tokens ≤ 20) call when it wants the model to invent a conversation
// title; everything else is treated as a real assistant turn. Keeping it
// pure makes the conditional unit-testable without spinning up the server.
func selectReply(req chatCompletionRequest) string {
	if isCompactionRequest(req) {
		return mockCompactionReply
	}
	tokenCap := req.MaxTokens
	if tokenCap == 0 {
		tokenCap = req.MaxCompletionTokens
	}
	if tokenCap > 0 && tokenCap <= 20 {
		return "Mocked conversation title"
	}
	if last := lastUserContent(req); strings.HasPrefix(last, echoPrefix) {
		return strings.TrimPrefix(last, echoPrefix)
	}
	return "Mocked assistant reply"
}

// lastUserContent returns the content of the final user message, or "" when
// there isn't one.
func lastUserContent(req chatCompletionRequest) string {
	for i := len(req.Messages) - 1; i >= 0; i-- {
		if req.Messages[i].Role == "user" {
			return req.Messages[i].Content
		}
	}
	return ""
}

// mockPNGBase64 is a valid 1x1 PNG, base64-encoded. Small enough to keep tests
// fast, real enough to round-trip through base64/data-URI decoding.
const mockPNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

// isImageModel mirrors how the real catalogue routes Gemini image models to the
// chat-completions transport: any model whose id mentions "image".
func isImageModel(model string) bool {
	return strings.Contains(strings.ToLower(model), "image")
}

// --- Dedicated Images API (OpenAI gpt-image style) ---

type imageGenerationRequest struct {
	Model          string `json:"model"`
	Prompt         string `json:"prompt"`
	N              int    `json:"n"`
	ResponseFormat string `json:"response_format"`
}

type imageData struct {
	B64JSON string `json:"b64_json,omitempty"`
	URL     string `json:"url,omitempty"`
}

type imageGenerationResponse struct {
	Created int64                 `json:"created"`
	Model   string                `json:"model"`
	Data    []imageData           `json:"data"`
	Usage   *imageGenerationUsage `json:"usage,omitempty"`
}

type imageGenerationUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
}

func imagesGenerationHandler(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req imageGenerationRequest
		if r.ContentLength != 0 {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				logger.Warn("decode failed", "err", err)
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
				return
			}
		}

		count := req.N
		if count <= 0 {
			count = 1
		}
		model := req.Model
		if model == "" {
			model = "mock-image-model"
		}

		logger.Info("image generation", "model", model, "n", count, "response_format", req.ResponseFormat)

		data := make([]imageData, 0, count)
		for range count {
			// Always inline bytes; the gateway requests b64_json so it never
			// receives a temporary URL.
			data = append(data, imageData{B64JSON: mockPNGBase64})
		}

		writeJSON(w, http.StatusOK, imageGenerationResponse{
			Created: time.Now().Unix(),
			Model:   model,
			Data:    data,
			// The Images API reports tokens only — no cost (mirrors real Requesty).
			Usage: &imageGenerationUsage{InputTokens: 11, OutputTokens: 4160, TotalTokens: 4171},
		})
	}
}

// --- Chat-completions image output (Gemini style) ---

// chatImageMessage mirrors choices[].message with the non-standard images[]
// array Requesty returns for Gemini image models.
type chatImageMessage struct {
	Role    string           `json:"role"`
	Content string           `json:"content"`
	Images  []chatImageBlock `json:"images"`
}

type chatImageBlock struct {
	Type     string            `json:"type"`
	ImageURL chatImageBlockURL `json:"image_url"`
}

type chatImageBlockURL struct {
	URL string `json:"url"`
}

type chatImageChoice struct {
	Index        int              `json:"index"`
	Message      chatImageMessage `json:"message"`
	FinishReason string           `json:"finish_reason"`
}

// chatImageUsage carries the provider cost at usage.cost, exactly as Requesty
// returns it (and where Bifrost's typed usage does not surface it).
type chatImageUsage struct {
	PromptTokens     int     `json:"prompt_tokens"`
	CompletionTokens int     `json:"completion_tokens"`
	TotalTokens      int     `json:"total_tokens"`
	Cost             float64 `json:"cost"`
}

type chatImageResponse struct {
	ID      string            `json:"id"`
	Object  string            `json:"object"`
	Created int64             `json:"created"`
	Model   string            `json:"model"`
	Choices []chatImageChoice `json:"choices"`
	Usage   chatImageUsage    `json:"usage"`
}

func writeChatImageResponse(w http.ResponseWriter, model string) {
	writeJSON(w, http.StatusOK, chatImageResponse{
		ID:      "chatcmpl-mock-image",
		Object:  "chat.completion",
		Created: time.Now().Unix(),
		Model:   model,
		Choices: []chatImageChoice{{
			Index:        0,
			FinishReason: "stop",
			Message: chatImageMessage{
				Role:    "assistant",
				Content: "Here is your image.",
				Images: []chatImageBlock{{
					Type:     "image_url",
					ImageURL: chatImageBlockURL{URL: "data:image/png;base64," + mockPNGBase64},
				}},
			},
		}},
		Usage: chatImageUsage{PromptTokens: 7, CompletionTokens: 1303, TotalTokens: 1310, Cost: 0.0387346},
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
