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
}

type chatCompletionUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
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

		reply := selectReply(req)
		model := req.Model
		if model == "" {
			model = "mock-model"
		}

		logger.Info("chat completion", "model", model, "reply", reply)
		writeJSON(w, http.StatusOK, chatCompletionResponse{
			ID:      "chatcmpl-mock",
			Object:  "chat.completion",
			Created: time.Now().Unix(),
			Model:   model,
			Choices: []chatCompletionChoice{{
				Index:        0,
				Message:      chatCompletionMsg{Role: "assistant", Content: reply},
				FinishReason: "stop",
			}},
			Usage: chatCompletionUsage{PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2},
		})
	}
}

// echoPrefix opts a request into echo mode: the latest user turn is replied to
// verbatim with the sentinel stripped. Tests use it to drive an arbitrarily
// large assistant reply (to exercise message-persistence limits) without baking
// sizes into the mock.
const echoPrefix = "[echo]"

// selectReply mirrors the .mjs heuristic: the backend issues a tiny
// (max_tokens ≤ 20) call when it wants the model to invent a conversation
// title; everything else is treated as a real assistant turn. Keeping it
// pure makes the conditional unit-testable without spinning up the server.
func selectReply(req chatCompletionRequest) string {
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

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
