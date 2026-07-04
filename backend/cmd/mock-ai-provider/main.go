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
	"unicode/utf8"
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
	mux.HandleFunc("POST /v1/responses", responsesHandler(logger))
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
	tokenCap := req.MaxTokens
	if tokenCap == 0 {
		tokenCap = req.MaxCompletionTokens
	}
	return replyFor(lastUserContent(req), tokenCap, isCompactionRequest(req))
}

// replyFor is the shared reply heuristic used by both the Chat Completions and
// Responses endpoints, so the two speak identically. Compaction wins, then the
// tiny-budget title call, then echo, then the default assistant reply.
func replyFor(lastUser string, tokenCap int, compaction bool) string {
	if compaction {
		return mockCompactionReply
	}
	if tokenCap > 0 && tokenCap <= 20 {
		return "Mocked conversation title"
	}
	if strings.HasPrefix(lastUser, echoPrefix) {
		return strings.TrimPrefix(lastUser, echoPrefix)
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

// --- OpenAI Responses API (used by the Requesty gateway path) ---
//
// The mock mirrors the real Vertex-Gemini-through-Requesty stream shape captured
// in the web-search spike so it is an honest regression harness, not an idealised
// one. In particular:
//   - url_citation annotations arrive on a SEPARATE, empty message output item
//     (a later output_index), never co-located with the visible text;
//   - annotation-bearing events report data.type "response.output_text.delta"
//     (Requesty mislabels them) while carrying an "annotation" field, so a
//     consumer must key off the annotation, not the type;
//   - annotation start/end offsets are UTF-8 BYTE offsets (webSearchReply carries
//     an accented word so byte and rune offsets differ);
//   - action.sources are proxy redirect URLs with no title;
//   - web_search_call activity events arrive at the END of the stream;
//   - usage.cost is a bare float, only reported under the [cost] sentinel so the
//     default stream stays cost-free and byte-identical to the chat path.
const (
	// webSearchReply is returned for web-search Responses requests. "légal" is
	// accented, so the citation's byte offsets differ from its code-point offsets.
	webSearchReply = "Le salaire minimum légal est fixé par le canton."
	// webSearchAnchor is the substring the mock citation anchors onto.
	webSearchAnchor = "légal"
	// costSentinel opts a Responses request into reporting a provider cost.
	costSentinel = "[cost]"
	// mockProviderCostUSD is the bare-float cost reported under [cost], mirroring
	// what Requesty returns for EU providers.
	mockProviderCostUSD = 0.0387346
	// Citation fixtures. The annotation carries a usable {url,title} (title is the
	// displayable domain); the action source is a title-less proxy redirect URL.
	mockCitationURL    = "https://example.com/geneva-minimum-wage"
	mockCitationTitle  = "example.com"
	mockSourceProxyURL = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/MOCKPROXY"

	// Azure-flavoured fixtures (models whose id contains "openai"): Unicode
	// CODE-POINT offsets, annotations on the SAME item as the text, real
	// destination URLs as action sources, search events BEFORE the text, and a
	// phantom empty search. "légal" is accented so code points differ from bytes.
	azureWebSearchReply = "Le salaire minimum légal à Genève est de 24,59 CHF brut par heure."
	azureAnchorText     = "légal"
	azureCitationURL    = "https://www.ge.ch/actualite/salaire-minimum-2026"
)

// azureSourceURLs are the real destination URLs the Azure fixture's search
// returns — more sources than are annotated, so citations exceed anchors.
var azureSourceURLs = []string{
	azureCitationURL,
	"https://www.admin.ch/minimum-wage-canton-geneva",
	"https://example.com/geneva-wage-2026",
}

// isAzureResponsesModel reports whether the model id selects the Azure OpenAI
// fixture shape (code-point offsets etc.), matching the gateway's family split.
func isAzureResponsesModel(model string) bool {
	return strings.Contains(strings.ToLower(model), "openai")
}

type responsesRequest struct {
	Model           string             `json:"model"`
	Stream          bool               `json:"stream"`
	MaxOutputTokens int                `json:"max_output_tokens"`
	Input           []responsesInput   `json:"input"`
	Tools           []responsesReqTool `json:"tools"`
}

type responsesReqTool struct {
	Type string `json:"type"`
}

type responsesInput struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

// Responses stream/response wire shapes (only the fields the gateway reads).
type responsesStreamEvent struct {
	Type            string               `json:"type"`
	SequenceNumber  int                  `json:"sequence_number"`
	OutputIndex     *int                 `json:"output_index,omitempty"`
	ContentIndex    *int                 `json:"content_index,omitempty"`
	ItemID          string               `json:"item_id,omitempty"`
	Delta           string               `json:"delta,omitempty"`
	Text            string               `json:"text,omitempty"`
	AnnotationIndex *int                 `json:"annotation_index,omitempty"`
	Annotation      *responsesAnnotation `json:"annotation,omitempty"`
	Item            *responsesItem       `json:"item,omitempty"`
	Response        *responsesObject     `json:"response,omitempty"`
}

type responsesAnnotation struct {
	Type       string `json:"type"`
	URL        string `json:"url"`
	Title      string `json:"title"`
	StartIndex int    `json:"start_index"`
	EndIndex   int    `json:"end_index"`
}

type responsesItem struct {
	ID      string                 `json:"id"`
	Type    string                 `json:"type"`
	Status  string                 `json:"status,omitempty"`
	Role    string                 `json:"role,omitempty"`
	Content []responsesContentBlk  `json:"content,omitempty"`
	Action  *responsesSearchAction `json:"action,omitempty"`
}

type responsesContentBlk struct {
	Type        string                `json:"type"`
	Text        string                `json:"text"`
	Annotations []responsesAnnotation `json:"annotations"`
}

type responsesSearchAction struct {
	Type    string            `json:"type"`
	Query   string            `json:"query,omitempty"`
	Queries []string          `json:"queries,omitempty"`
	Sources []responsesSource `json:"sources,omitempty"`
}

type responsesSource struct {
	Type  string `json:"type"`
	URL   string `json:"url"`
	Title string `json:"title,omitempty"`
}

type responsesObject struct {
	ID        string          `json:"id"`
	Object    string          `json:"object"`
	CreatedAt int64           `json:"created_at"`
	Model     string          `json:"model"`
	Status    string          `json:"status"`
	Output    []responsesItem `json:"output"`
	Usage     *responsesUsage `json:"usage,omitempty"`
}

type responsesUsage struct {
	InputTokens         int                     `json:"input_tokens"`
	OutputTokens        int                     `json:"output_tokens"`
	TotalTokens         int                     `json:"total_tokens"`
	OutputTokensDetails *responsesOutputDetails `json:"output_tokens_details,omitempty"`
	// Cost is a bare float, matching what Requesty returns; nil = not reported.
	Cost *float64 `json:"cost,omitempty"`
}

type responsesOutputDetails struct {
	ReasoningTokens int `json:"reasoning_tokens,omitempty"`
}

func responsesHandler(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req responsesRequest
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

		lastUser := responsesLastUserText(req)
		reply := replyFor(lastUser, req.MaxOutputTokens, responsesIsCompaction(req))
		reasoning := ""
		if strings.HasPrefix(lastUser, reasonPrefix) {
			reasoning = reasoningTrace
		}
		webSearch := responsesHasWebSearchTool(req)
		// A web search request with the default reply gets an accented answer so
		// the citation exercises offset conversion — the Azure fixture uses its own
		// reply (code-point offsets) and the default (Vertex-shaped) reply uses
		// byte offsets.
		if webSearch && reply == "Mocked assistant reply" {
			if isAzureResponsesModel(model) {
				reply = azureWebSearchReply
			} else {
				reply = webSearchReply
			}
		}
		var cost *float64
		if strings.Contains(lastUser, costSentinel) {
			c := mockProviderCostUSD
			cost = &c
		}

		logger.Info("responses completion", "model", model, "stream", req.Stream, "web_search", webSearch)

		if req.Stream {
			writeResponsesStream(w, logger, model, reply, reasoning, webSearch, cost)
			return
		}
		writeResponsesJSON(w, model, reply, reasoning, webSearch, cost)
	}
}

// writeResponsesStream emits a Responses-API SSE stream mirroring the real Vertex
// shape. Bifrost reads the `data:` JSON (keying off data.type), so no `event:`
// line is needed.
func writeResponsesStream(
	w http.ResponseWriter,
	logger *slog.Logger,
	model, reply, reasoning string,
	webSearch bool,
	cost *float64,
) {
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

	const respID = "resp-mock"
	created := time.Now().Unix()
	seq := 0
	send := func(ev responsesStreamEvent) {
		ev.SequenceNumber = seq
		seq++
		payload, _ := json.Marshal(ev)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
		flusher.Flush()
	}
	inProgress := &responsesObject{ID: respID, Object: "response", CreatedAt: created, Model: model, Status: "in_progress", Output: []responsesItem{}}

	send(responsesStreamEvent{Type: "response.created", Response: inProgress})
	send(responsesStreamEvent{Type: "response.in_progress", Response: inProgress})

	// completedSearchItem builds a web_search_call "done" event. Requesty mistypes
	// these as output_item.added in the JSON body, so mirror that: the JSON type
	// is added while the item status is completed.
	completedSearchItem := func(idx int, action *responsesSearchAction) responsesStreamEvent {
		return responsesStreamEvent{Type: "response.output_item.added", OutputIndex: ptrInt(idx), Item: &responsesItem{Type: "web_search_call", Status: "completed", Action: action}}
	}
	searchLifecycle := func(idx int) {
		send(responsesStreamEvent{Type: "response.output_item.added", OutputIndex: ptrInt(idx), Item: &responsesItem{Type: "web_search_call", Status: "in_progress", Action: &responsesSearchAction{Type: "search"}}})
		send(responsesStreamEvent{Type: "response.web_search_call.in_progress", OutputIndex: ptrInt(idx)})
		send(responsesStreamEvent{Type: "response.web_search_call.searching", OutputIndex: ptrInt(idx)})
		send(responsesStreamEvent{Type: "response.web_search_call.completed", OutputIndex: ptrInt(idx)})
	}

	if webSearch && isAzureResponsesModel(model) {
		// Azure shape: searches BEFORE the text (a real one + a phantom), then a
		// message whose annotations sit on the SAME item, with code-point offsets.
		sources := make([]responsesSource, 0, len(azureSourceURLs))
		for _, u := range azureSourceURLs {
			sources = append(sources, responsesSource{Type: "url", URL: u})
		}
		searchLifecycle(0)
		send(completedSearchItem(0, &responsesSearchAction{Type: "search", Query: "geneva minimum wage 2026", Sources: sources}))
		// Phantom search: empty query, no sources — must not count or cite.
		searchLifecycle(1)
		send(completedSearchItem(1, &responsesSearchAction{Type: "search", Queries: []string{""}}))

		startCP, endCP := codePointSpan(reply, azureAnchorText)
		send(responsesStreamEvent{Type: "response.output_item.added", OutputIndex: ptrInt(2), Item: &responsesItem{Type: "message", Role: "assistant", Status: "in_progress"}})
		send(responsesStreamEvent{Type: "response.content_part.added", OutputIndex: ptrInt(2), ContentIndex: ptrInt(0)})
		if reasoning != "" {
			send(responsesStreamEvent{Type: "response.reasoning_summary_text.delta", OutputIndex: ptrInt(2), Delta: reasoning})
		}
		send(responsesStreamEvent{Type: "response.output_text.delta", OutputIndex: ptrInt(2), ContentIndex: ptrInt(0), Delta: reply})
		// Annotation on the SAME item as the text (mislabeled output_text.delta).
		send(responsesStreamEvent{
			Type: "response.output_text.delta", OutputIndex: ptrInt(2), ContentIndex: ptrInt(0), AnnotationIndex: ptrInt(0),
			Annotation: &responsesAnnotation{Type: "url_citation", URL: azureCitationURL, Title: "", StartIndex: startCP, EndIndex: endCP},
		})
		send(responsesStreamEvent{Type: "response.output_text.done", OutputIndex: ptrInt(2), ContentIndex: ptrInt(0), Text: reply})
		send(responsesStreamEvent{Type: "response.output_item.done", OutputIndex: ptrInt(2), Item: &responsesItem{
			Type: "message", Role: "assistant", Status: "completed",
			Content: []responsesContentBlk{{Type: "output_text", Text: reply, Annotations: []responsesAnnotation{{Type: "url_citation", URL: azureCitationURL, StartIndex: startCP, EndIndex: endCP}}}},
		}})
	} else {
		// Default (Vertex Gemini) shape: text first, then a separate empty
		// annotation item (byte offsets), then the search AFTER the text.
		send(responsesStreamEvent{Type: "response.output_item.added", OutputIndex: ptrInt(0), Item: &responsesItem{Type: "message", Role: "assistant", Status: "in_progress"}})
		send(responsesStreamEvent{Type: "response.content_part.added", OutputIndex: ptrInt(0), ContentIndex: ptrInt(0)})
		if reasoning != "" {
			send(responsesStreamEvent{Type: "response.reasoning_summary_text.delta", OutputIndex: ptrInt(0), Delta: reasoning})
		}
		send(responsesStreamEvent{Type: "response.output_text.delta", OutputIndex: ptrInt(0), ContentIndex: ptrInt(0), Delta: reply})
		send(responsesStreamEvent{Type: "response.output_text.done", OutputIndex: ptrInt(0), ContentIndex: ptrInt(0), Text: reply})
		send(responsesStreamEvent{Type: "response.content_part.done", OutputIndex: ptrInt(0), ContentIndex: ptrInt(0)})
		send(responsesStreamEvent{Type: "response.output_item.done", OutputIndex: ptrInt(0), Item: &responsesItem{
			Type: "message", Role: "assistant", Status: "completed",
			Content: []responsesContentBlk{{Type: "output_text", Text: reply, Annotations: []responsesAnnotation{}}},
		}})

		if webSearch {
			startByte := strings.Index(reply, webSearchAnchor)
			endByte := startByte + len(webSearchAnchor)
			if startByte < 0 {
				startByte, endByte = 0, len(reply)
			}
			// Citation annotation on a SECOND, empty message item (byte offsets).
			send(responsesStreamEvent{Type: "response.output_item.added", OutputIndex: ptrInt(1), Item: &responsesItem{Type: "message", Role: "assistant", Status: "in_progress"}})
			send(responsesStreamEvent{Type: "response.content_part.added", OutputIndex: ptrInt(1), ContentIndex: ptrInt(0)})
			send(responsesStreamEvent{
				Type: "response.output_text.delta", OutputIndex: ptrInt(1), ContentIndex: ptrInt(0), AnnotationIndex: ptrInt(0),
				Annotation: &responsesAnnotation{Type: "url_citation", URL: mockCitationURL, Title: mockCitationTitle, StartIndex: startByte, EndIndex: endByte},
			})
			send(responsesStreamEvent{Type: "response.output_item.done", OutputIndex: ptrInt(1), Item: &responsesItem{Type: "message", Role: "assistant", Status: "completed"}})

			// Search AFTER the text (mistyped done carries the sources).
			searchLifecycle(2)
			send(completedSearchItem(2, &responsesSearchAction{Type: "search", Query: "mock query", Sources: []responsesSource{{Type: "url", URL: mockSourceProxyURL}}}))
		}
	}

	// Terminal event carries usage (and cost, when requested).
	usage := &responsesUsage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2, Cost: cost}
	if reasoning != "" {
		usage.OutputTokensDetails = &responsesOutputDetails{ReasoningTokens: reasoningTokenCount}
	}
	send(responsesStreamEvent{Type: "response.completed", Response: &responsesObject{
		ID: respID, Object: "response", CreatedAt: created, Model: model, Status: "completed", Output: []responsesItem{}, Usage: usage,
	}})

	_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	flusher.Flush()
}

// codePointSpan returns the code-point [start,end) offsets of target within text,
// or [0, runeLen) when target is absent.
func codePointSpan(text, target string) (int, int) {
	byteIdx := strings.Index(text, target)
	if byteIdx < 0 {
		return 0, utf8.RuneCountInString(text)
	}
	start := utf8.RuneCountInString(text[:byteIdx])
	return start, start + utf8.RuneCountInString(target)
}

// writeResponsesJSON serves the non-streaming Responses request. Annotations sit
// on the message content block here (the non-stream shape); web search adds a
// web_search_call output item with proxy action sources.
func writeResponsesJSON(w http.ResponseWriter, model, reply, reasoning string, webSearch bool, cost *float64) {
	content := responsesContentBlk{Type: "output_text", Text: reply, Annotations: []responsesAnnotation{}}
	output := []responsesItem{}
	if webSearch {
		startByte := strings.Index(reply, webSearchAnchor)
		endByte := startByte + len(webSearchAnchor)
		if startByte < 0 {
			startByte, endByte = 0, len(reply)
		}
		content.Annotations = append(content.Annotations, responsesAnnotation{
			Type: "url_citation", URL: mockCitationURL, Title: mockCitationTitle, StartIndex: startByte, EndIndex: endByte,
		})
	}
	output = append(output, responsesItem{Type: "message", Role: "assistant", Status: "completed", Content: []responsesContentBlk{content}})
	if webSearch {
		output = append(output, responsesItem{
			Type: "web_search_call", Status: "completed",
			Action: &responsesSearchAction{Type: "search", Query: "mock query", Sources: []responsesSource{{Type: "url", URL: mockSourceProxyURL}}},
		})
	}

	usage := &responsesUsage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2, Cost: cost}
	if reasoning != "" {
		usage.OutputTokensDetails = &responsesOutputDetails{ReasoningTokens: reasoningTokenCount}
	}
	writeJSON(w, http.StatusOK, responsesObject{
		ID: "resp-mock", Object: "response", CreatedAt: time.Now().Unix(), Model: model, Status: "completed", Output: output, Usage: usage,
	})
}

// responsesLastUserText returns the text of the final user input message.
func responsesLastUserText(req responsesRequest) string {
	for i := len(req.Input) - 1; i >= 0; i-- {
		if req.Input[i].Role == "user" {
			return responsesContentText(req.Input[i].Content)
		}
	}
	return ""
}

// responsesContentText extracts plain text from a Responses content field, which
// is either a JSON string or an array of {type,text} input blocks.
func responsesContentText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		return asString
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &blocks); err == nil {
		var b strings.Builder
		for _, block := range blocks {
			b.WriteString(block.Text)
		}
		return b.String()
	}
	return ""
}

// responsesIsCompaction reports whether a system/developer input carries the
// compaction system prompt.
func responsesIsCompaction(req responsesRequest) bool {
	for _, m := range req.Input {
		if m.Role == "system" || m.Role == "developer" {
			if strings.Contains(responsesContentText(m.Content), compactionSystemMarker) {
				return true
			}
		}
	}
	return false
}

func responsesHasWebSearchTool(req responsesRequest) bool {
	for _, tool := range req.Tools {
		if tool.Type == "web_search" {
			return true
		}
	}
	return false
}

func ptrInt(i int) *int { return &i }

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
