package gateway

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/maximhq/bifrost/core/schemas"
	"pgregory.net/rapid"
)

// fataler is the subset of testing.TB that both *testing.T and *rapid.T
// satisfy, so collectStream works from a table test and a property alike.
type fataler interface {
	Helper()
	Fatalf(format string, args ...any)
}

// collectStream drains a CompleteStream into its citations, anchors and any
// terminal error, so the edge tests can assert on the normalised output.
func collectStream(t fataler, req CompleteRequest, chunks ...*schemas.BifrostStreamChunk) ([]Citation, []CitationAnchor, []string, *Usage, error) {
	t.Helper()
	stream := make(chan *schemas.BifrostStreamChunk, len(chunks)+1)
	for _, c := range chunks {
		stream <- c
	}
	close(stream)

	client := NewBifrostClient(&stubBifrostRequester{respStream: stream}, nil, nil, nil)
	out, err := client.CompleteStream(context.Background(), req)
	if err != nil {
		t.Fatalf("CompleteStream() error = %v", err)
	}

	var citations []Citation
	var anchors []CitationAnchor
	var activity []string
	var usage *Usage
	var streamErr error
	for event := range out {
		if event.Err != nil {
			streamErr = event.Err
			continue
		}
		citations = append(citations, event.Citations...)
		anchors = append(anchors, event.CitationAnchors...)
		if event.SearchActivity != "" {
			activity = append(activity, event.SearchActivity)
		}
		if event.Usage != nil {
			usage = event.Usage
		}
	}
	return citations, anchors, activity, usage, streamErr
}

// respAnnotationChunkNoURL mirrors an annotation that carries a title but no URL
// (or a blank one) — unusable as a citation, so it must be dropped entirely.
func respAnnotationChunkNoURL(title string, blankURL bool) *schemas.BifrostStreamChunk {
	ann := &schemas.ResponsesOutputMessageContentTextAnnotation{
		Type:  "url_citation",
		Title: &title,
	}
	if blankURL {
		blank := "   "
		ann.URL = &blank
	}
	return &schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type:       schemas.ResponsesStreamResponseTypeOutputTextDelta,
			Annotation: ann,
		},
	}
}

// respFailedChunk builds an in-band terminal error event carrying only a
// structured code (never free text — see responsesStreamError).
func respFailedChunk(code string) *schemas.BifrostStreamChunk {
	return &schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type: schemas.ResponsesStreamResponseTypeFailed,
			Code: &code,
		},
	}
}

func webSearchReq() CompleteRequest {
	return CompleteRequest{ProviderID: "requesty", ProviderModelID: "model", WebSearch: true}
}

// A URL cited by BOTH an annotation (with a title) and a later action source
// (title-less proxy) must collapse to ONE citation, and the annotation's title
// must win — the action source never overwrites a richer annotation title.
func TestCompleteStreamCitationDeduplicatesAcrossAnnotationAndActionSource(t *testing.T) {
	t.Parallel()

	const url = "https://shared.example/page"
	citations, anchors, _, _, err := collectStream(t, webSearchReq(),
		respTextChunk("abcdefghij"),
		respAnnotationChunk(url, "shared.example", 0, 3),
		respSearchItemAddedChunk(),
		// The action source repeats the same URL but with no title.
		respSearchSourcesChunk(url),
		respCompletedChunk(&schemas.ResponsesResponseUsage{}),
	)
	if err != nil {
		t.Fatalf("stream error = %v", err)
	}
	if len(citations) != 1 {
		t.Fatalf("citations = %#v, want 1 (same URL across annotation + action source collapses)", citations)
	}
	if citations[0].Title != "shared.example" {
		t.Fatalf("citation title = %q, want the annotation title to win over the title-less action source", citations[0].Title)
	}
	if len(anchors) != 1 || anchors[0].CitationIndex != 0 {
		t.Fatalf("anchors = %#v, want a single anchor at citation 0", anchors)
	}
}

// An annotation with a title but no usable URL is not a citation — it is dropped
// entirely (no citation, no anchor), never emitted as a title-only source.
func TestCompleteStreamDropsAnnotationWithoutURL(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name  string
		chunk *schemas.BifrostStreamChunk
	}{
		{name: "nil URL", chunk: respAnnotationChunkNoURL("Some Title", false)},
		{name: "blank URL", chunk: respAnnotationChunkNoURL("Some Title", true)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			citations, anchors, _, _, err := collectStream(t, webSearchReq(),
				respTextChunk("abcdefghij"),
				tc.chunk,
				respCompletedChunk(&schemas.ResponsesResponseUsage{}),
			)
			if err != nil {
				t.Fatalf("stream error = %v", err)
			}
			if len(citations) != 0 {
				t.Fatalf("citations = %#v, want none (annotation without a URL is dropped)", citations)
			}
			if len(anchors) != 0 {
				t.Fatalf("anchors = %#v, want none", anchors)
			}
		})
	}
}

// The non-streaming extractor drops title-only (URL-less) annotations too, so
// the two code paths agree.
func TestExtractResponsesOutputDropsAnnotationWithoutURL(t *testing.T) {
	t.Parallel()

	messageType := schemas.ResponsesMessageTypeMessage
	role := schemas.ResponsesInputMessageRoleAssistant
	start, end := 0, 3
	output := []schemas.ResponsesMessage{{
		Type: &messageType,
		Role: &role,
		Content: &schemas.ResponsesMessageContent{
			ContentBlocks: []schemas.ResponsesMessageContentBlock{{
				Type: schemas.ResponsesOutputMessageContentTypeText,
				Text: stringPtr("abcdefghij"),
				ResponsesOutputMessageContentText: &schemas.ResponsesOutputMessageContentText{
					Annotations: []schemas.ResponsesOutputMessageContentTextAnnotation{{
						Type:       "url_citation",
						Title:      stringPtr("Title only"),
						StartIndex: &start,
						EndIndex:   &end,
					}},
				},
			}},
		},
	}}

	_, _, citations, anchors, _ := extractResponsesOutput(output, offsetUnitUnknown)
	if len(citations) != 0 {
		t.Fatalf("citations = %#v, want none (URL-less annotation dropped)", citations)
	}
	if len(anchors) != 0 {
		t.Fatalf("anchors = %#v, want none", anchors)
	}
}

// A zero-length anchor (start == end) is a valid caret position and must be
// KEPT — only start > end is inverted and dropped.
func TestCompleteStreamKeepsZeroLengthAnchor(t *testing.T) {
	t.Parallel()

	citations, anchors, _, _, err := collectStream(t, webSearchReq(),
		respTextChunk("abcdef"),
		respAnnotationChunk("https://x.example/a", "x.example", 3, 3),
		respCompletedChunk(&schemas.ResponsesResponseUsage{}),
	)
	if err != nil {
		t.Fatalf("stream error = %v", err)
	}
	if len(citations) != 1 {
		t.Fatalf("citations = %#v, want 1", citations)
	}
	if len(anchors) != 1 || anchors[0].StartIndex != 3 || anchors[0].EndIndex != 3 {
		t.Fatalf("anchors = %#v, want a single zero-length anchor at [3,3]", anchors)
	}
}

// Anchors are resolved once at the terminal event against the COMPLETE answer,
// not against the text seen so far — so an annotation that arrives before its
// text (offsets would be out of range against the empty accumulator at arrival)
// still resolves correctly against the finished text.
func TestCompleteStreamAnnotationBeforeTextResolvesAgainstCompleteAnswer(t *testing.T) {
	t.Parallel()

	citations, anchors, _, _, err := collectStream(t, webSearchReq(),
		respAnnotationChunk("https://early.example/a", "early.example", 0, 5),
		respTextChunk("some answer text"),
		respCompletedChunk(&schemas.ResponsesResponseUsage{}),
	)
	if err != nil {
		t.Fatalf("stream error = %v", err)
	}
	if len(citations) != 1 {
		t.Fatalf("citations = %#v, want the citation surfaced", citations)
	}
	// "model" is an unknown family → strict byte validation; [0,5] is a valid
	// rune-aligned byte span of "some answer text" → kept.
	if len(anchors) != 1 || anchors[0].StartIndex != 0 || anchors[0].EndIndex != 5 {
		t.Fatalf("anchors = %#v, want one anchor [0,5] resolved against the complete answer", anchors)
	}
}

// An anchor whose offsets exceed the complete answer is dropped (never guessed),
// but the citation is still surfaced.
func TestCompleteStreamOutOfRangeAnchorDroppedKeepsCitation(t *testing.T) {
	t.Parallel()

	citations, anchors, _, _, err := collectStream(t, webSearchReq(),
		respTextChunk("short"),
		respAnnotationChunk("https://x.example/a", "x.example", 0, 999),
		respCompletedChunk(&schemas.ResponsesResponseUsage{}),
	)
	if err != nil {
		t.Fatalf("stream error = %v", err)
	}
	if len(citations) != 1 {
		t.Fatalf("citations = %#v, want the citation surfaced even with an unusable anchor", citations)
	}
	if len(anchors) != 0 {
		t.Fatalf("anchors = %#v, want none (offset out of range, never guessed)", anchors)
	}
}

// SearchCount is the number of COMPLETED, real web_search_call items — never the
// in-progress "added" events (which would double-count, since Requesty mistypes
// the completed done event as another added), and never a phantom search (empty
// query, no sources). item_id is empty on Gemini, so counting keys off status +
// content, not an id.
func TestCompleteStreamSearchCountCountsCompletedRealSearches(t *testing.T) {
	t.Parallel()

	// Two real searches (each an in-progress added + a completed item with
	// sources) plus a phantom completed item that must be excluded.
	phantomType := schemas.ResponsesMessageTypeWebSearchCall
	phantomStatus := "completed"
	phantom := &schemas.BifrostStreamChunk{
		BifrostResponsesStreamResponse: &schemas.BifrostResponsesStreamResponse{
			Type: schemas.ResponsesStreamResponseTypeOutputItemAdded, // Requesty mistype
			Item: &schemas.ResponsesMessage{
				Type:   &phantomType,
				Status: &phantomStatus,
				ResponsesToolMessage: &schemas.ResponsesToolMessage{
					Action: &schemas.ResponsesToolMessageActionStruct{
						ResponsesWebSearchToolCallAction: &schemas.ResponsesWebSearchToolCallAction{Queries: []string{""}},
					},
				},
			},
		},
	}

	_, _, _, usage, err := collectStream(t, webSearchReq(),
		respSearchItemAddedChunk(),
		respSearchSourcesChunk("https://a.example/1"),
		respSearchItemAddedChunk(),
		respSearchSourcesChunk("https://b.example/2"),
		phantom,
		respTextChunk("answer"),
		respCompletedChunk(&schemas.ResponsesResponseUsage{}),
	)
	if err != nil {
		t.Fatalf("stream error = %v", err)
	}
	if usage == nil || usage.SearchCount != 2 {
		t.Fatalf("usage = %#v, want SearchCount 2 (two completed real searches; phantom excluded)", usage)
	}
}

// When a citation has already been emitted and the stream then fails before the
// terminal event, the gateway surfaces the citation first, then the error — it
// never swallows work already streamed to the client. (The handler discards the
// partial response on error; this pins the gateway half of that contract.)
func TestCompleteStreamEmitsCitationsThenErrorOnMidStreamFailure(t *testing.T) {
	t.Parallel()

	citations, _, _, _, err := collectStream(t, webSearchReq(),
		respTextChunk("partial answer"),
		respAnnotationChunk("https://cited.example/a", "cited.example", 0, 7),
		respFailedChunk("provider_overloaded"),
		// A terminal usage event after the failure must never be reached.
		respCompletedChunk(&schemas.ResponsesResponseUsage{TotalTokens: 99}),
	)
	if err == nil {
		t.Fatal("stream error = nil, want the mid-stream failure surfaced")
	}
	if !strings.Contains(err.Error(), "provider_overloaded") {
		t.Fatalf("error = %v, want the structured code surfaced", err)
	}
	if len(citations) != 1 || citations[0].URL != "https://cited.example/a" {
		t.Fatalf("citations = %#v, want the pre-error citation still emitted", citations)
	}
}

// Property: byteOffsetToRuneOffset agrees with a []rune oracle at every valid
// rune-boundary byte offset (round-trips over arbitrary Unicode incl. emoji),
// and never panics or misreports for arbitrary — including invalid — offsets.
func TestByteOffsetToRuneOffsetProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		s := rapid.String().Draw(t, "text")

		// Every rune-start byte index (plus len(s)) is a valid boundary and must
		// round-trip to its code-point offset.
		for b := range s {
			got, ok := byteOffsetToRuneOffset(s, b)
			if !ok {
				t.Fatalf("byteOffsetToRuneOffset(%q, %d) not ok, want a valid boundary", s, b)
			}
			if want := utf8.RuneCountInString(s[:b]); got != want {
				t.Fatalf("byteOffsetToRuneOffset(%q, %d) = %d, want %d", s, b, got, want)
			}
		}
		if got, ok := byteOffsetToRuneOffset(s, len(s)); !ok || got != utf8.RuneCountInString(s) {
			t.Fatalf("byteOffsetToRuneOffset(%q, len) = %d,%v, want %d,true", s, got, ok, utf8.RuneCountInString(s))
		}

		// Arbitrary offset: must never panic, and when it reports ok it must be a
		// true rune boundary whose conversion matches the oracle.
		off := rapid.IntRange(-1_000, len(s)+1_000).Draw(t, "offset")
		got, ok := byteOffsetToRuneOffset(s, off)
		if ok {
			if off < 0 || off > len(s) {
				t.Fatalf("byteOffsetToRuneOffset(%q, %d) ok for an out-of-range offset", s, off)
			}
			if off < len(s) && !utf8.RuneStart(s[off]) {
				t.Fatalf("byteOffsetToRuneOffset(%q, %d) ok mid-rune", s, off)
			}
			if want := utf8.RuneCountInString(s[:off]); got != want {
				t.Fatalf("byteOffsetToRuneOffset(%q, %d) = %d, want %d", s, off, got, want)
			}
		}
	})
}

// annotationOffsetUnit maps provider families to their citation-offset encoding,
// verified against the captured streams in testdata/.
func TestAnnotationOffsetUnit(t *testing.T) {
	t.Parallel()

	cases := []struct {
		providerModelID string
		want            offsetUnit
	}{
		{"vertex/gemini-3.5-flash@eu", offsetUnitBytes},
		{"vertex/gemini-2.5-pro@europe-west1", offsetUnitBytes},
		{"azure/openai-responses/gpt-5.5@swedencentral", offsetUnitCodePoints},
		{"azure/openai-responses/gpt-4.1-mini@francecentral", offsetUnitCodePoints},
		{"openai/gpt-5.5", offsetUnitCodePoints},
		{"bedrock/claude-sonnet-4-6@eu-central-1", offsetUnitUnknown},
		{"azure/gpt-5-nano@swedencentral", offsetUnitUnknown},
		{"", offsetUnitUnknown},
	}
	for _, tc := range cases {
		if got := annotationOffsetUnit(tc.providerModelID); got != tc.want {
			t.Fatalf("annotationOffsetUnit(%q) = %v, want %v", tc.providerModelID, got, tc.want)
		}
	}
}

// Property: resolveAnchors runs per offset unit. In byte mode a rune-aligned byte
// span converts to its code-point span; in code-point mode an in-bounds span
// passes through unchanged. Neither mode ever panics or yields an inverted or
// out-of-bounds rune span.
func TestResolveAnchorsPerUnitProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		text := rapid.String().Draw(t, "text")
		runeLen := utf8.RuneCountInString(text)

		// Byte mode: choose two rune-boundary byte offsets.
		boundaries := []int{0}
		for b := range text {
			if b != 0 {
				boundaries = append(boundaries, b)
			}
		}
		boundaries = append(boundaries, len(text))
		i := rapid.IntRange(0, len(boundaries)-1).Draw(t, "i")
		j := rapid.IntRange(0, len(boundaries)-1).Draw(t, "j")
		startByte, endByte := boundaries[i], boundaries[j]
		if startByte > endByte {
			startByte, endByte = endByte, startByte
		}
		byteAnchors := resolveAnchors(text, offsetUnitBytes, []rawAnchor{{citationIndex: 0, start: startByte, end: endByte}})
		if len(byteAnchors) != 1 {
			t.Fatalf("byte mode dropped a valid rune-aligned span [%d,%d] of %q", startByte, endByte, text)
		}
		if want := utf8.RuneCountInString(text[:startByte]); byteAnchors[0].StartIndex != want {
			t.Fatalf("byte mode start = %d, want %d", byteAnchors[0].StartIndex, want)
		}
		if want := utf8.RuneCountInString(text[:endByte]); byteAnchors[0].EndIndex != want {
			t.Fatalf("byte mode end = %d, want %d", byteAnchors[0].EndIndex, want)
		}

		// Code-point mode: choose two in-bounds code-point offsets; they pass
		// through unchanged.
		cpStart := rapid.IntRange(0, runeLen).Draw(t, "cpStart")
		cpEnd := rapid.IntRange(0, runeLen).Draw(t, "cpEnd")
		if cpStart > cpEnd {
			cpStart, cpEnd = cpEnd, cpStart
		}
		cpAnchors := resolveAnchors(text, offsetUnitCodePoints, []rawAnchor{{citationIndex: 0, start: cpStart, end: cpEnd}})
		if len(cpAnchors) != 1 || cpAnchors[0].StartIndex != cpStart || cpAnchors[0].EndIndex != cpEnd {
			t.Fatalf("code-point mode = %#v, want pass-through [%d,%d]", cpAnchors, cpStart, cpEnd)
		}
	})
}

// Property: over an arbitrary sequence of text deltas and citation annotations,
// the accumulated citations are de-duplicated by URL with stable first-seen
// indices, and every anchor references a real citation and a code-point span
// within the visible answer. This exercises the real CompleteStream goroutine.
func TestCompleteStreamCitationAccumulationProperty(t *testing.T) {
	t.Parallel()

	urlPool := []string{
		"https://a.example/1",
		"https://b.example/2",
		"https://c.example/3",
		"", // empty URLs must be ignored, never counted
	}

	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(0, 24).Draw(t, "events")
		chunks := make([]*schemas.BifrostStreamChunk, 0, n+1)
		for i := 0; i < n; i++ {
			if rapid.Bool().Draw(t, "isText") {
				chunks = append(chunks, respTextChunk(rapid.String().Draw(t, "delta")))
				continue
			}
			url := rapid.SampledFrom(urlPool).Draw(t, "url")
			start := rapid.IntRange(-5, 40).Draw(t, "start")
			end := rapid.IntRange(-5, 40).Draw(t, "end")
			if url == "" {
				chunks = append(chunks, respAnnotationChunkNoURL("t", false))
			} else {
				chunks = append(chunks, respAnnotationChunk(url, "title-"+url, start, end))
			}
		}
		chunks = append(chunks, respCompletedChunk(&schemas.ResponsesResponseUsage{}))

		citations, anchors, _, _, err := collectStream(t, webSearchReq(), chunks...)
		if err != nil {
			t.Fatalf("stream error = %v", err)
		}

		// Citations are de-duplicated by URL with stable indices.
		seen := make(map[string]bool, len(citations))
		for i, c := range citations {
			if c.URL == "" {
				t.Fatalf("citation %d has an empty URL, want empty URLs ignored", i)
			}
			if seen[c.URL] {
				t.Fatalf("citation %d duplicates URL %q, want de-duplication by URL", i, c.URL)
			}
			seen[c.URL] = true
		}

		// Every anchor references a real citation and a non-inverted rune span
		// that fits inside the fully accumulated answer.
		totalRunes := 0
		for _, c := range chunks {
			r := c.BifrostResponsesStreamResponse
			if r.Type == schemas.ResponsesStreamResponseTypeOutputTextDelta && r.Annotation == nil && r.Delta != nil {
				totalRunes += utf8.RuneCountInString(*r.Delta)
			}
		}
		for _, a := range anchors {
			if a.CitationIndex < 0 || a.CitationIndex >= len(citations) {
				t.Fatalf("anchor %#v references a citation out of range [0,%d)", a, len(citations))
			}
			if a.StartIndex < 0 || a.StartIndex > a.EndIndex || a.EndIndex > totalRunes {
				t.Fatalf("anchor %#v is not a valid span within %d runes", a, totalRunes)
			}
		}
	})
}
