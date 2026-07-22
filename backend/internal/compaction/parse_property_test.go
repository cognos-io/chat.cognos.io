package compaction

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"pgregory.net/rapid"
)

// Property: well-formed <compaction> JSON always parses, preserves narrative and
// memory items, and never invents citations for unknown aliases.
func TestParseDelimitedRoundTripProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		items := rapid.SliceOfN(rapid.StringMatching(`[A-Za-z0-9 ._-]{1,40}`), 0, 5).
			Draw(t, "items")
		narrative := rapid.StringMatching(`[A-Za-z0-9 ._-]{0,80}`).Draw(t, "narrative")
		knownAlias := rapid.StringMatching(`M[1-9]`).Draw(t, "alias")
		messageID := rapid.StringMatching(`[a-z0-9_]{8,16}`).Draw(t, "messageID")

		body, err := json.Marshal(map[string]any{
			"durable_memory": map[string]any{
				"items": items,
			},
			"rolling_narrative": narrative,
			"citations":        []string{knownAlias, "M99"},
		})
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}

		raw := "preamble\n<compaction>\n" + string(body) + "\n</compaction>\ntrailer"
		got, err := Parse(raw, map[string]string{knownAlias: messageID})
		if err != nil {
			t.Fatalf("Parse: %v", err)
		}
		if strings.TrimSpace(got.RollingNarrative) != strings.TrimSpace(narrative) {
			t.Fatalf("narrative = %q, want %q", got.RollingNarrative, narrative)
		}
		if len(got.DurableMemory.Items) != len(items) {
			t.Fatalf("items len = %d, want %d", len(got.DurableMemory.Items), len(items))
		}
		for _, c := range got.Citations {
			if c.Label == "M99" {
				t.Fatal("unknown alias M99 must be dropped, not invented")
			}
			if c.Label == knownAlias && c.MessageID != messageID {
				t.Fatalf("citation %q mapped to %q, want %q", c.Label, c.MessageID, messageID)
			}
		}
	})
}

// Property: arbitrary strings either parse successfully or fail with
// ErrNoCompactionBlock — never a panic or unrelated error type. Successful
// parses are allowed: extractJSON may recover a coincidental {...} span, and
// that path is still fail-closed on unmarshal errors via ErrNoCompactionBlock.
func TestParseGarbageFailsClosedProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		raw := rapid.String().Draw(t, "raw")
		_, err := Parse(raw, nil)
		if err == nil {
			return
		}
		if !errors.Is(err, ErrNoCompactionBlock) {
			t.Fatalf("Parse error = %v, want ErrNoCompactionBlock", err)
		}
	})
}
