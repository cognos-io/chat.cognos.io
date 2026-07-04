package gateway

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"unicode/utf8"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
)

type bifrostRequester interface {
	ChatCompletionRequest(ctx *schemas.BifrostContext, req *schemas.BifrostChatRequest) (*schemas.BifrostChatResponse, *schemas.BifrostError)
	ChatCompletionStreamRequest(ctx *schemas.BifrostContext, req *schemas.BifrostChatRequest) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError)
	ResponsesRequest(ctx *schemas.BifrostContext, req *schemas.BifrostResponsesRequest) (*schemas.BifrostResponsesResponse, *schemas.BifrostError)
	ResponsesStreamRequest(ctx *schemas.BifrostContext, req *schemas.BifrostResponsesRequest) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError)
	ImageGenerationRequest(ctx *schemas.BifrostContext, req *schemas.BifrostImageGenerationRequest) (*schemas.BifrostImageGenerationResponse, *schemas.BifrostError)
}

type bifrostShutdowner interface {
	Shutdown()
}

type BifrostClient struct {
	requester bifrostRequester
	shutdown  bifrostShutdowner
	account   schemas.Account
	logger    *slog.Logger
}

func NewBifrostClient(
	requester bifrostRequester,
	shutdown bifrostShutdowner,
	account schemas.Account,
	logger *slog.Logger,
) *BifrostClient {
	return &BifrostClient{
		requester: requester,
		shutdown:  shutdown,
		account:   account,
		logger:    logger,
	}
}

func NewConfiguredBifrostClient(account schemas.Account, logLevel string, logger *slog.Logger) (*BifrostClient, error) {
	if account == nil {
		return nil, fmt.Errorf("bifrost account is required")
	}

	runtime, err := bifrost.Init(context.Background(), schemas.BifrostConfig{
		Account:         account,
		InitialPoolSize: schemas.DefaultInitialPoolSize,
		Logger:          bifrost.NewDefaultLogger(parseBifrostLogLevel(logLevel)),
	})
	if err != nil {
		return nil, err
	}

	return NewBifrostClient(runtime, runtime, account, logger), nil
}

func (c *BifrostClient) Shutdown() {
	if c == nil || c.shutdown == nil {
		return
	}
	c.shutdown.Shutdown()
}

func (c *BifrostClient) Account() schemas.Account {
	if c == nil {
		return nil
	}
	return c.account
}

func (c *BifrostClient) Complete(ctx context.Context, req CompleteRequest) (CompleteResponse, error) {
	if c == nil || c.requester == nil {
		return CompleteResponse{}, fmt.Errorf("bifrost client is not configured")
	}

	responsesReq, err := c.buildResponsesRequest(req)
	if err != nil {
		return CompleteResponse{}, err
	}

	bifrostCtx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	resp, bifrostErr := c.requester.ResponsesRequest(bifrostCtx, responsesReq)
	if bifrostErr != nil {
		c.logBifrostError(req, bifrostErr)
		return CompleteResponse{}, fmt.Errorf("bifrost request failed: %s", safeErrorSummary(bifrostErr))
	}
	if resp == nil {
		return CompleteResponse{}, fmt.Errorf("bifrost returned nil response")
	}

	content, reasoning, citations, anchors, searchCount := extractResponsesOutput(resp.Output, annotationOffsetUnit(req.ProviderModelID))
	usage := responsesUsage(resp.Usage)
	usage.SearchCount = searchCount

	return CompleteResponse{
		Message: Message{
			Role:    "assistant",
			Content: content,
		},
		Reasoning:       reasoning,
		Citations:       citations,
		CitationAnchors: anchors,
		Usage:           usage,
	}, nil
}

func (c *BifrostClient) CompleteStream(ctx context.Context, req CompleteRequest) (<-chan CompleteStreamEvent, error) {
	if c == nil || c.requester == nil {
		return nil, fmt.Errorf("bifrost client is not configured")
	}

	responsesReq, err := c.buildResponsesRequest(req)
	if err != nil {
		return nil, err
	}

	bifrostCtx := schemas.NewBifrostContext(ctx, schemas.NoDeadline)
	stream, bifrostErr := c.requester.ResponsesStreamRequest(bifrostCtx, responsesReq)
	if bifrostErr != nil {
		c.logBifrostError(req, bifrostErr)
		return nil, fmt.Errorf("bifrost request failed: %s", safeErrorSummary(bifrostErr))
	}
	if stream == nil {
		return nil, fmt.Errorf("bifrost returned nil stream")
	}

	out := make(chan CompleteStreamEvent)
	go func() {
		defer close(out)

		// De-duplicate citations by URL with stable indices; accumulate the visible
		// answer so annotation offsets can be resolved against the text they index
		// into; buffer raw anchors and resolve them all at the terminal event
		// against the complete text (offset units are family-dependent — see
		// annotationOffsetUnit).
		unit := annotationOffsetUnit(req.ProviderModelID)
		citationIndex := make(map[string]int)
		var visible strings.Builder
		var pending []rawAnchor
		searchStarted := false
		searchCount := 0

		// addCitation records a source under its URL (first occurrence wins),
		// appending a newly-seen one to the event, and returns its stable index.
		addCitation := func(event *CompleteStreamEvent, url, title string) int {
			if idx, seen := citationIndex[url]; seen {
				return idx
			}
			idx := len(citationIndex)
			citationIndex[url] = idx
			event.Citations = append(event.Citations, Citation{URL: url, Title: title})
			return idx
		}

		for chunk := range stream {
			if chunk == nil {
				continue
			}
			if chunk.BifrostError != nil {
				c.logBifrostError(req, chunk.BifrostError)
				out <- CompleteStreamEvent{Err: fmt.Errorf("bifrost request failed: %s", safeErrorSummary(chunk.BifrostError))}
				return
			}
			resp := chunk.BifrostResponsesStreamResponse
			if resp == nil {
				continue
			}

			event := CompleteStreamEvent{}

			// Citation annotation. Requesty mislabels these as output_text.delta
			// while carrying an annotation field, so key off the annotation pointer
			// rather than the event type. Anchors are buffered and resolved at the
			// terminal event (offset units and full text are only known then).
			if ann := resp.Annotation; ann != nil && ann.URL != nil && strings.TrimSpace(*ann.URL) != "" {
				idx := addCitation(&event, *ann.URL, derefString(ann.Title))
				if ann.StartIndex != nil && ann.EndIndex != nil {
					pending = append(pending, rawAnchor{citationIndex: idx, start: *ann.StartIndex, end: *ann.EndIndex})
				}
			}

			// Web search call items. Requesty mistypes output_item.done as
			// output_item.added in the JSON body (same mistype family as the
			// annotation events), so the done never carries its own event type —
			// key off the item's status instead. A completed item with a real query
			// or ≥1 source is a genuine search: harvest its sources and count it
			// once. A completed item with an empty query and no sources is a phantom
			// (observed on Azure gpt-5.5) — it must not count or emit activity.
			if isWebSearchItem(resp.Item) {
				switch derefString(resp.Item.Status) {
				case "in_progress":
					if !searchStarted {
						searchStarted = true
						event.SearchActivity = SearchActivityStarted
					}
				case "completed":
					if webSearchItemIsReal(resp.Item) {
						searchCount++
						for _, src := range webSearchActionCitations(resp.Item) {
							addCitation(&event, src.URL, src.Title)
						}
						event.SearchActivity = SearchActivityCompleted
					}
				}
			}

			switch resp.Type {
			case schemas.ResponsesStreamResponseTypeOutputTextDelta:
				// Annotation-bearing chunks share this type but carry no text.
				if resp.Annotation == nil && resp.Delta != nil {
					event.Delta = *resp.Delta
					visible.WriteString(*resp.Delta)
				}
			case schemas.ResponsesStreamResponseTypeReasoningSummaryTextDelta:
				if resp.Delta != nil {
					event.ReasoningDelta = *resp.Delta
				}
			case schemas.ResponsesStreamResponseTypeCompleted,
				schemas.ResponsesStreamResponseTypeIncomplete:
				event.CitationAnchors = resolveAnchors(visible.String(), unit, pending)
				usage := responsesUsage(nil)
				if resp.Response != nil {
					usage = responsesUsage(resp.Response.Usage)
				}
				usage.SearchCount = searchCount
				event.Usage = &usage
			case schemas.ResponsesStreamResponseTypeFailed,
				schemas.ResponsesStreamResponseTypeError:
				out <- CompleteStreamEvent{Err: fmt.Errorf("bifrost request failed: %s", responsesStreamError(resp))}
				return
			}

			if event.Delta == "" && event.ReasoningDelta == "" && event.Usage == nil &&
				len(event.Citations) == 0 && len(event.CitationAnchors) == 0 && event.SearchActivity == "" {
				continue
			}

			out <- event
		}
	}()

	return out, nil
}

// buildResponsesRequest maps a gateway CompleteRequest onto Bifrost's Responses
// API request. The system prompt arrives as an ordinary system-role message in
// req.Messages (built by the handler's persona layer), so it is mapped as a
// system-role input item — no separate Instructions handling. Web search, when
// requested, adds the provider-native web_search tool plus the include flag that
// returns the searched sources.
func (c *BifrostClient) buildResponsesRequest(req CompleteRequest) (*schemas.BifrostResponsesRequest, error) {
	if strings.TrimSpace(req.ProviderID) == "" {
		return nil, fmt.Errorf("bifrost provider id is required")
	}
	if strings.TrimSpace(req.ProviderModelID) == "" {
		return nil, fmt.Errorf("bifrost model id is required")
	}

	input := make([]schemas.ResponsesMessage, 0, len(req.Messages))
	for _, message := range req.Messages {
		role := schemas.ResponsesMessageRoleType(message.Role)
		msgType := schemas.ResponsesMessageTypeMessage
		input = append(input, schemas.ResponsesMessage{
			Type:    &msgType,
			Role:    &role,
			Content: buildResponsesMessageContent(message.Content, message.Images, message.Files),
		})
	}

	responsesReq := &schemas.BifrostResponsesRequest{
		Provider: schemas.ModelProvider(req.ProviderID),
		Model:    req.ProviderModelID,
		Input:    input,
	}
	if req.MaxOutputTokens > 0 || req.ReasoningEffort != "" || req.JSONResponseFormat || req.WebSearch {
		responsesReq.Params = &schemas.ResponsesParameters{}
	}
	if req.MaxOutputTokens > 0 {
		maxTokens := req.MaxOutputTokens
		responsesReq.Params.MaxOutputTokens = &maxTokens
	}
	if reasoning := responsesReasoningParam(req.ReasoningEffort); reasoning != nil {
		// Send the thinking budget explicitly (Anthropic's thinking.budget_tokens)
		// so we own the max_tokens > budget invariant rather than depending on the
		// router's effort→budget mapping. responsesReasoningParam only returns
		// non-nil for an enabled tier, so a budget here is always for active
		// reasoning.
		if req.ReasoningMaxTokens > 0 {
			budget := req.ReasoningMaxTokens
			reasoning.MaxTokens = &budget
		}
		responsesReq.Params.Reasoning = reasoning
	}
	if req.JSONResponseFormat {
		// OpenAI-compatible JSON mode on the Responses API (text.format instead of
		// chat's response_format). Bifrost passes this through to the provider;
		// providers that don't support it ignore it, so the caller must still
		// tolerate non-JSON output.
		responsesReq.Params.Text = &schemas.ResponsesTextConfig{
			Format: &schemas.ResponsesTextConfigFormat{Type: "json_object"},
		}
	}
	if req.WebSearch {
		// Provider-native web search: Requesty maps {"type":"web_search"} to the
		// underlying provider's own search. Include the action sources so the
		// searched pages come back for citation rendering.
		responsesReq.Params.Tools = append(responsesReq.Params.Tools, schemas.ResponsesTool{
			Type: schemas.ResponsesToolTypeWebSearch,
		})
		responsesReq.Params.Include = append(responsesReq.Params.Include, "web_search_call.action.sources")
	}

	return responsesReq, nil
}

// responsesReasoningParam translates a user-selected effort into Bifrost's
// Responses reasoning parameter. Empty AND the disabling tiers ("off"/"none")
// return nil, so NO reasoning parameter is sent — that is the portable,
// OpenAI-compatible way to request no extended thinking.
//
// We must NOT send effort "none" to disable: Requesty is a Bifrost custom
// provider, which skips reasoning normalisation and forwards the param verbatim.
// Requesty/Bedrock then reads the mere presence of a reasoning param as
// "thinking on" and applies a default budget — so "none" actually ENABLES
// thinking, and a small max_tokens (e.g. title generation's ~15) trips
// Anthropic's "max_tokens > thinking.budget_tokens" 400. Omitting the param
// leaves Claude at its thinking-off default. Every other tier passes through
// verbatim.
func responsesReasoningParam(effort string) *schemas.ResponsesParametersReasoning {
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "", "off", "none":
		return nil
	default:
		e := effort
		return &schemas.ResponsesParametersReasoning{Effort: &e}
	}
}

// buildResponsesMessageContent renders a gateway message into Bifrost Responses
// content. With no images or files it stays a plain string; otherwise it becomes
// input content blocks (an optional input_text block, then input_image data-URL
// blocks, then input_file data-URL blocks).
func buildResponsesMessageContent(
	content string,
	images []MessageImage,
	files []MessageFile,
) *schemas.ResponsesMessageContent {
	if len(images) == 0 && len(files) == 0 {
		text := content
		return &schemas.ResponsesMessageContent{ContentStr: &text}
	}

	blocks := make([]schemas.ResponsesMessageContentBlock, 0, len(images)+len(files)+1)
	if content != "" {
		text := content
		blocks = append(blocks, schemas.ResponsesMessageContentBlock{
			Type: schemas.ResponsesInputMessageContentBlockTypeText,
			Text: &text,
		})
	}
	for _, image := range images {
		dataURL := "data:" + image.MimeType + ";base64," + image.Base64
		blocks = append(blocks, schemas.ResponsesMessageContentBlock{
			Type: schemas.ResponsesInputMessageContentBlockTypeImage,
			ResponsesInputMessageContentBlockImage: &schemas.ResponsesInputMessageContentBlockImage{
				ImageURL: &dataURL,
			},
		})
	}
	for _, file := range files {
		dataURL := "data:" + file.MimeType + ";base64," + file.Base64
		filename := file.Filename
		fileType := file.MimeType
		blocks = append(blocks, schemas.ResponsesMessageContentBlock{
			Type: schemas.ResponsesInputMessageContentBlockTypeFile,
			ResponsesInputMessageContentBlockFile: &schemas.ResponsesInputMessageContentBlockFile{
				FileData: &dataURL,
				Filename: &filename,
				FileType: &fileType,
			},
		})
	}
	return &schemas.ResponsesMessageContent{ContentBlocks: blocks}
}

// responsesUsage maps Bifrost's Responses usage onto the neutral Usage. Provider
// cost lives at usage.cost as a bare float (Requesty's shape) and is verified to
// be pure token cost with no search surcharge. SearchCount is filled by the
// caller (this family reports no search-count usage field).
func responsesUsage(u *schemas.ResponsesResponseUsage) Usage {
	if u == nil {
		return Usage{}
	}
	usage := Usage{
		InputTokens:  int64(u.InputTokens),
		OutputTokens: int64(u.OutputTokens),
		TotalTokens:  int64(u.TotalTokens),
	}
	if d := u.InputTokensDetails; d != nil {
		usage.CacheReadInputTokens = int64(d.CachedReadTokens)
		usage.CacheCreationInputTokens = int64(d.CachedWriteTokens)
		if w := d.CachedWriteTokenDetails; w != nil {
			usage.CacheCreationInputTokens = int64(w.CachedWriteTokens5m + w.CachedWriteTokens1h)
		}
	}
	if d := u.OutputTokensDetails; d != nil {
		usage.ReasoningTokens = int64(d.ReasoningTokens)
	}
	if u.Cost != nil {
		cost := u.Cost.TotalCost
		usage.ProviderCostUSD = &cost
	}
	return usage
}

// extractResponsesOutput flattens a non-streaming Responses output into the
// neutral answer, reasoning, citations, anchors and search count. It mirrors the
// streaming path: sources are harvested from completed web_search_call items
// (phantom searches excluded), annotations add citations and buffer anchors, and
// the anchors are resolved once against the complete text using the family's
// offset unit.
func extractResponsesOutput(output []schemas.ResponsesMessage, unit offsetUnit) (content, reasoning string, citations []Citation, anchors []CitationAnchor, searchCount int) {
	var contentB, reasoningB strings.Builder
	citationIndex := make(map[string]int)
	var pending []rawAnchor

	addCitation := func(url, title string) int {
		if idx, seen := citationIndex[url]; seen {
			return idx
		}
		idx := len(citationIndex)
		citationIndex[url] = idx
		citations = append(citations, Citation{URL: url, Title: title})
		return idx
	}

	for i := range output {
		item := &output[i]
		if isWebSearchItem(item) {
			// Only genuine searches count and contribute sources; a phantom
			// (empty query, no sources) is ignored (Azure gpt-5.5).
			if webSearchItemIsReal(item) {
				searchCount++
				for _, src := range webSearchActionCitations(item) {
					addCitation(src.URL, src.Title)
				}
			}
			continue
		}
		if item.Content != nil {
			for bi := range item.Content.ContentBlocks {
				block := &item.Content.ContentBlocks[bi]
				switch block.Type {
				case schemas.ResponsesOutputMessageContentTypeText:
					if block.Text != nil {
						contentB.WriteString(*block.Text)
					}
					if t := block.ResponsesOutputMessageContentText; t != nil {
						for ai := range t.Annotations {
							ann := &t.Annotations[ai]
							if ann.URL == nil || strings.TrimSpace(*ann.URL) == "" {
								continue
							}
							idx := addCitation(*ann.URL, derefString(ann.Title))
							if ann.StartIndex != nil && ann.EndIndex != nil {
								pending = append(pending, rawAnchor{citationIndex: idx, start: *ann.StartIndex, end: *ann.EndIndex})
							}
						}
					}
				case schemas.ResponsesOutputMessageContentTypeReasoning:
					if block.Text != nil {
						reasoningB.WriteString(*block.Text)
					}
				}
			}
		}
		if item.ResponsesReasoning != nil {
			for _, summary := range item.Summary {
				reasoningB.WriteString(summary.Text)
			}
		}
	}
	anchors = resolveAnchors(contentB.String(), unit, pending)
	return contentB.String(), reasoningB.String(), citations, anchors, searchCount
}

// isWebSearchItem reports whether a Responses output item is a web_search_call.
func isWebSearchItem(item *schemas.ResponsesMessage) bool {
	return item != nil && item.Type != nil && *item.Type == schemas.ResponsesMessageTypeWebSearchCall
}

// webSearchItemIsReal reports whether a web_search_call carried a real query or
// returned at least one source. Requesty (Azure gpt-5.5) sometimes emits a
// phantom search — a completed item with an empty query and no sources — which
// must not count toward billing or emit search activity.
func webSearchItemIsReal(item *schemas.ResponsesMessage) bool {
	if item == nil || item.ResponsesToolMessage == nil || item.Action == nil {
		return false
	}
	action := item.Action.ResponsesWebSearchToolCallAction
	if action == nil {
		return false
	}
	if len(action.Sources) > 0 {
		return true
	}
	if action.Query != nil && strings.TrimSpace(*action.Query) != "" {
		return true
	}
	for _, q := range action.Queries {
		if strings.TrimSpace(q) != "" {
			return true
		}
	}
	return false
}

// webSearchActionCitations extracts citations from a web_search_call item's
// action sources. Sources may be provider proxy URLs (Vertex) or real
// destination URLs (Azure); titles are usually absent (de-dup at the call site
// lets an annotation title win when present).
func webSearchActionCitations(item *schemas.ResponsesMessage) []Citation {
	if !isWebSearchItem(item) || item.ResponsesToolMessage == nil || item.Action == nil ||
		item.Action.ResponsesWebSearchToolCallAction == nil {
		return nil
	}
	var citations []Citation
	for _, src := range item.Action.ResponsesWebSearchToolCallAction.Sources {
		if strings.TrimSpace(src.URL) == "" {
			continue
		}
		citations = append(citations, Citation{URL: src.URL, Title: derefString(src.Title)})
	}
	return citations
}

// offsetUnit is the encoding a provider family uses for url_citation
// start_index/end_index.
type offsetUnit int

const (
	// offsetUnitBytes: UTF-8 byte offsets (Vertex Gemini).
	offsetUnitBytes offsetUnit = iota
	// offsetUnitCodePoints: Unicode code-point offsets (Azure OpenAI / OpenAI).
	offsetUnitCodePoints
	// offsetUnitUnknown: family not recognised — never guess (see resolveAnchors).
	offsetUnitUnknown
)

// annotationOffsetUnit selects the citation-offset encoding by provider family,
// verified empirically against captured streams in testdata/:
//
//	vertex/gemini*                      → UTF-8 BYTE offsets   (stream-vertex-raw.txt)
//	azure/openai-responses/*, *openai*  → Unicode CODE-POINT offsets
//	                                      (stream-azure-gpt55-raw.txt: max end_index
//	                                       828 == code-point length; byte length 846)
//	anything else                       → unknown (strict byte-only validation)
//
// The units genuinely differ: applying byte→rune to Azure's code-point offsets
// silently corrupts anchors (offset 468 lands on an ASCII byte, so a rune-boundary
// check does not catch it).
func annotationOffsetUnit(providerModelID string) offsetUnit {
	id := strings.ToLower(strings.TrimSpace(providerModelID))
	switch {
	case strings.HasPrefix(id, "vertex/gemini"):
		return offsetUnitBytes
	case strings.HasPrefix(id, "azure/openai-responses/"),
		strings.HasPrefix(id, "openai/"),
		strings.Contains(id, "openai"):
		return offsetUnitCodePoints
	default:
		return offsetUnitUnknown
	}
}

// rawAnchor is an unresolved citation anchor: a citation index plus the
// provider's raw start/end offsets (in the family's offset unit).
type rawAnchor struct {
	citationIndex int
	start, end    int
}

// resolveAnchors converts raw provider offsets into code-point CitationAnchors
// against text, per the family's offset unit. Anchors that are out of range,
// inverted, or (for byte offsets) land inside a multi-byte rune are dropped —
// never guessed (spec §7). For an unknown family it applies strict byte-only
// validation: if every anchor is a valid byte offset it treats them as bytes,
// otherwise it drops them all (code points would be plausible but unproven).
func resolveAnchors(text string, unit offsetUnit, raws []rawAnchor) []CitationAnchor {
	if len(raws) == 0 {
		return nil
	}
	switch unit {
	case offsetUnitCodePoints:
		return resolveCodePointAnchors(text, raws)
	case offsetUnitBytes:
		return resolveByteAnchors(text, raws)
	default:
		return resolveUnknownAnchors(text, raws)
	}
}

// resolveByteAnchors treats offsets as UTF-8 bytes, dropping individually
// invalid anchors and keeping the valid ones.
func resolveByteAnchors(text string, raws []rawAnchor) []CitationAnchor {
	var out []CitationAnchor
	for _, r := range raws {
		if anchor, ok := byteAnchor(text, r); ok {
			out = append(out, anchor)
		}
	}
	return out
}

// resolveCodePointAnchors treats offsets as code points, validating bounds and
// dropping individually invalid anchors.
func resolveCodePointAnchors(text string, raws []rawAnchor) []CitationAnchor {
	runeLen := utf8.RuneCountInString(text)
	var out []CitationAnchor
	for _, r := range raws {
		if r.start < 0 || r.end < r.start || r.end > runeLen {
			continue
		}
		out = append(out, CitationAnchor{CitationIndex: r.citationIndex, StartIndex: r.start, EndIndex: r.end})
	}
	return out
}

// resolveUnknownAnchors applies strict all-or-nothing byte validation: only if
// EVERY anchor is a valid, rune-aligned byte offset does it accept the byte
// interpretation; otherwise it drops all anchors rather than guess.
func resolveUnknownAnchors(text string, raws []rawAnchor) []CitationAnchor {
	out := make([]CitationAnchor, 0, len(raws))
	for _, r := range raws {
		anchor, ok := byteAnchor(text, r)
		if !ok {
			return nil
		}
		out = append(out, anchor)
	}
	return out
}

// byteAnchor resolves one anchor under the byte interpretation.
func byteAnchor(text string, r rawAnchor) (CitationAnchor, bool) {
	start, ok := byteOffsetToRuneOffset(text, r.start)
	if !ok {
		return CitationAnchor{}, false
	}
	end, ok := byteOffsetToRuneOffset(text, r.end)
	if !ok || start > end {
		return CitationAnchor{}, false
	}
	return CitationAnchor{CitationIndex: r.citationIndex, StartIndex: start, EndIndex: end}, true
}

// byteOffsetToRuneOffset converts a UTF-8 byte offset within text to a code-point
// (rune) offset. ok is false when the offset is negative, past the end, or lands
// inside a multi-byte rune.
func byteOffsetToRuneOffset(text string, byteOffset int) (int, bool) {
	if byteOffset < 0 || byteOffset > len(text) {
		return 0, false
	}
	if byteOffset < len(text) && !utf8.RuneStart(text[byteOffset]) {
		return 0, false
	}
	return utf8.RuneCountInString(text[:byteOffset]), true
}

// responsesStreamError builds a safe summary of an in-band Responses error event.
// It uses only structured codes — never the free-text Message/Param, which can
// echo plaintext user content — mirroring safeErrorSummary.
func responsesStreamError(resp *schemas.BifrostResponsesStreamResponse) string {
	if resp == nil {
		return "unspecified provider error"
	}
	if resp.Code != nil && strings.TrimSpace(*resp.Code) != "" {
		return "code=" + *resp.Code
	}
	if resp.Response != nil && resp.Response.Error != nil && strings.TrimSpace(resp.Response.Error.Code) != "" {
		return "code=" + resp.Response.Error.Code
	}
	return "unspecified provider error"
}

func (c *BifrostClient) logBifrostError(req CompleteRequest, bifrostErr *schemas.BifrostError) {
	c.logProviderError(req.ProviderID, req.ProviderModelID, bifrostErr)
}

// logProviderError logs a provider failure using only structured, non-sensitive
// fields (provider, model, status/type/code). It deliberately never logs the
// prompt, the free-text error message, or any generated content.
func (c *BifrostClient) logProviderError(providerID, modelID string, bifrostErr *schemas.BifrostError) {
	if c == nil || c.logger == nil || bifrostErr == nil {
		return
	}

	attrs := []any{
		"provider", strings.TrimSpace(providerID),
		"model", strings.TrimSpace(modelID),
		"status_code", derefInt(bifrostErr.StatusCode),
		"error_type", derefString(bifrostErrorType(bifrostErr)),
		"error_code", derefString(bifrostErrorCode(bifrostErr)),
		"original_model_requested", bifrostErr.ExtraFields.OriginalModelRequested,
		"resolved_model_used", bifrostErr.ExtraFields.ResolvedModelUsed,
	}
	c.logger.Error("bifrost request failed", attrs...)
}

// ClampBifrostLogLevel bounds the bifrost log level so it is never more
// verbose than "warn" outside dev mode: the upstream library may log request
// bodies — i.e. plaintext prompts — at debug/info, and Cognos never logs user
// content. Returns the effective level and whether it was clamped (so the
// caller can log a warning). Unrecognised/empty levels pass through untouched;
// parseBifrostLogLevel already defaults those to "error".
func ClampBifrostLogLevel(level string, devMode bool) (string, bool) {
	if devMode {
		return level, false
	}
	switch strings.ToLower(strings.TrimSpace(level)) {
	case string(schemas.LogLevelDebug), string(schemas.LogLevelInfo):
		return string(schemas.LogLevelWarn), true
	default:
		return level, false
	}
}

func parseBifrostLogLevel(level string) schemas.LogLevel {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case string(schemas.LogLevelDebug):
		return schemas.LogLevelDebug
	case string(schemas.LogLevelInfo):
		return schemas.LogLevelInfo
	case string(schemas.LogLevelWarn):
		return schemas.LogLevelWarn
	default:
		return schemas.LogLevelError
	}
}

func bifrostErrorType(bifrostErr *schemas.BifrostError) *string {
	if bifrostErr == nil || bifrostErr.Error == nil {
		return nil
	}
	return bifrostErr.Error.Type
}

func bifrostErrorCode(bifrostErr *schemas.BifrostError) *string {
	if bifrostErr == nil || bifrostErr.Error == nil {
		return nil
	}
	return bifrostErr.Error.Code
}

// safeErrorSummary describes a provider failure using only structured,
// provider-defined fields (status, type, code). It deliberately omits the
// free-text Error.Message: some providers echo parts of the request — and
// therefore plaintext user content — back in that field. Cognos never logs or
// propagates user data, so the message must not reach logs or wrapped errors.
func safeErrorSummary(bifrostErr *schemas.BifrostError) string {
	if bifrostErr == nil {
		return "unknown error"
	}

	parts := make([]string, 0, 3)
	if bifrostErr.StatusCode != nil {
		parts = append(parts, fmt.Sprintf("status=%d", *bifrostErr.StatusCode))
	}
	if errorType := derefString(bifrostErrorType(bifrostErr)); errorType != "" {
		parts = append(parts, "type="+errorType)
	}
	if errorCode := derefString(bifrostErrorCode(bifrostErr)); errorCode != "" {
		parts = append(parts, "code="+errorCode)
	}
	if len(parts) == 0 {
		return "unspecified provider error"
	}
	return strings.Join(parts, " ")
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func derefInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
