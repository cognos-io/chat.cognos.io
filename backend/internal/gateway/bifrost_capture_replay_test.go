package gateway

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/maximhq/bifrost/core/schemas"
)

// Capture-replay is the regression bedrock for web-search normalisation: real
// provider streams captured through Requesty (backend/internal/gateway/testdata/
// *.sse) are replayed through CompleteStream and asserted exactly. The captures
// are the only ground truth once the API key is rotated.
//
// Each capture is raw SSE (`event:`/`data:` lines). Bifrost parses the `data:`
// JSON, so the replay unmarshals each data line into a BifrostResponsesStreamResponse
// exactly as Bifrost's stream reader would, and feeds it through the gateway.

// replayCapture parses a captured SSE stream and runs it through CompleteStream
// for the given provider model id, returning the normalised output plus the
// reference visible answer (accumulated text deltas) for anchor cross-checks.
func replayCapture(t *testing.T, path, providerModelID string) (citations []Citation, anchors []CitationAnchor, activity []string, usage *Usage, refText string) {
	t.Helper()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read capture %s: %v", path, err)
	}

	var chunks []*schemas.BifrostStreamChunk
	var textB strings.Builder
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			continue
		}
		var resp schemas.BifrostResponsesStreamResponse
		if err := json.Unmarshal([]byte(payload), &resp); err != nil {
			t.Fatalf("unmarshal capture event %q: %v", payload, err)
		}
		if resp.Type == schemas.ResponsesStreamResponseTypeOutputTextDelta && resp.Annotation == nil && resp.Delta != nil {
			textB.WriteString(*resp.Delta)
		}
		chunks = append(chunks, &schemas.BifrostStreamChunk{BifrostResponsesStreamResponse: &resp})
	}

	req := CompleteRequest{ProviderID: "requesty", ProviderModelID: providerModelID, WebSearch: true}
	citations, anchors, activity, usage, streamErr := collectStream(t, req, chunks...)
	if streamErr != nil {
		t.Fatalf("replay stream error = %v", streamErr)
	}
	return citations, anchors, activity, usage, textB.String()
}

func TestCaptureReplayVertexGemini(t *testing.T) {
	t.Parallel()

	citations, anchors, activity, usage, refText := replayCapture(
		t, "testdata/stream-vertex-gemini.sse", "vertex/gemini-3.5-flash@eu",
	)

	// Byte-offset family: 7 annotations over 5 distinct proxy URLs, each with a
	// domain title; the search's 5 action sources repeat those URLs (no new
	// citations). Titles come from the annotations, which arrive before the
	// sources on this family.
	wantTitles := []string{"admin.ch", "ge.ch", "newlandchase.com", "fer-ge.ch", "swissinfo.ch"}
	if len(citations) != len(wantTitles) {
		t.Fatalf("citations = %d, want %d\n%#v", len(citations), len(wantTitles), citations)
	}
	for i, want := range wantTitles {
		if citations[i].Title != want {
			t.Fatalf("citation[%d].Title = %q, want %q", i, citations[i].Title, want)
		}
		if !strings.HasPrefix(citations[i].URL, "https://vertexaisearch.cloud.google.com/") {
			t.Fatalf("citation[%d].URL = %q, want a Vertex proxy URL", i, citations[i].URL)
		}
	}

	// 7 anchors; byte offsets converted to code points against the answer.
	type span struct{ citation, startByte, endByte int }
	wantSpans := []span{
		{0, 0, 96}, {1, 0, 96}, {0, 100, 228}, {1, 100, 228},
		{2, 232, 457}, {3, 232, 457}, {4, 459, 787},
	}
	if len(anchors) != len(wantSpans) {
		t.Fatalf("anchors = %d, want %d\n%#v", len(anchors), len(wantSpans), anchors)
	}
	for i, s := range wantSpans {
		wantStart := utf8.RuneCountInString(refText[:s.startByte])
		wantEnd := utf8.RuneCountInString(refText[:s.endByte])
		if anchors[i].CitationIndex != s.citation || anchors[i].StartIndex != wantStart || anchors[i].EndIndex != wantEnd {
			t.Fatalf("anchor[%d] = %#v, want {citation:%d start:%d end:%d} (byte [%d,%d])",
				i, anchors[i], s.citation, wantStart, wantEnd, s.startByte, s.endByte)
		}
		// Byte offsets must genuinely differ from code points (accented text),
		// otherwise this capture wouldn't exercise the conversion.
		if s.endByte != wantEnd && i == len(wantSpans)-1 {
			// last span [459,787] spans accented text; confirm shrinkage.
			if wantEnd >= s.endByte {
				t.Fatalf("expected code-point end %d < byte end %d for accented text", wantEnd, s.endByte)
			}
		}
	}

	if usage == nil || usage.SearchCount != 1 {
		t.Fatalf("usage = %#v, want SearchCount 1", usage)
	}
	if len(activity) == 0 || activity[len(activity)-1] != SearchActivityCompleted {
		t.Fatalf("activity = %#v, want it to end with completed", activity)
	}
}

func TestCaptureReplayAzureGPT55(t *testing.T) {
	t.Parallel()

	citations, anchors, _, usage, _ := replayCapture(
		t, "testdata/stream-azure-gpt55.sse", "azure/openai-responses/gpt-5.5@swedencentral",
	)

	// The real search returned 15 sources (title-less real URLs); the phantom
	// search (empty query, no sources) contributes nothing. The two annotations
	// repeat a source URL, so no new citations. Result: 15 citations.
	if len(citations) != 15 {
		t.Fatalf("citations = %d, want 15 (all sources, phantom excluded)\n%#v", len(citations), citations)
	}
	// Source-first URL is title-less; the frontend labels it by hostname.
	const geURL = "https://www.ge.ch/actualite/salaire-minimum-genevois-2026-etablira-2459-fr-heure-1-10-2025"
	if citations[3].URL != geURL || citations[3].Title != "" {
		t.Fatalf("citation[3] = %#v, want the title-less ge.ch source", citations[3])
	}

	// Code-point-offset family: anchors pass through unchanged and reference the
	// ge.ch citation at index 3.
	want := []CitationAnchor{{CitationIndex: 3, StartIndex: 468, EndIndex: 569}, {CitationIndex: 3, StartIndex: 727, EndIndex: 828}}
	if len(anchors) != len(want) {
		t.Fatalf("anchors = %#v, want %#v", anchors, want)
	}
	for i := range want {
		if anchors[i] != want[i] {
			t.Fatalf("anchor[%d] = %#v, want %#v (code points pass through)", i, anchors[i], want[i])
		}
	}

	if usage == nil || usage.SearchCount != 1 {
		t.Fatalf("usage = %#v, want SearchCount 1 (phantom empty search excluded)", usage)
	}
	if usage.ProviderCostUSD == nil || *usage.ProviderCostUSD != 0.06633 {
		t.Fatalf("provider cost = %#v, want 0.06633", usage.ProviderCostUSD)
	}
}

func TestCaptureReplayAzureGPT54(t *testing.T) {
	t.Parallel()

	citations, anchors, _, usage, _ := replayCapture(
		t, "testdata/stream-azure-gpt54.sse", "azure/openai-responses/gpt-5.4@swedencentral",
	)

	if len(citations) != 13 {
		t.Fatalf("citations = %d, want 13 (all sources)\n%#v", len(citations), citations)
	}
	const geURL = "https://www.ge.ch/actualite/salaire-minimum-genevois-2026-etablira-2459-fr-heure-1-10-2025"
	if citations[1].URL != geURL {
		t.Fatalf("citation[1].URL = %q, want the ge.ch source", citations[1].URL)
	}

	want := []CitationAnchor{{CitationIndex: 1, StartIndex: 331, EndIndex: 432}, {CitationIndex: 1, StartIndex: 593, EndIndex: 694}}
	if len(anchors) != len(want) {
		t.Fatalf("anchors = %#v, want %#v", anchors, want)
	}
	for i := range want {
		if anchors[i] != want[i] {
			t.Fatalf("anchor[%d] = %#v, want %#v", i, anchors[i], want[i])
		}
	}

	if usage == nil || usage.SearchCount != 1 {
		t.Fatalf("usage = %#v, want SearchCount 1", usage)
	}
}
