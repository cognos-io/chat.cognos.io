package compaction

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"

	"golang.org/x/crypto/nacl/box"
)

func TestParseExtractsDelimitedJSONAndResolvesCitations(t *testing.T) {
	t.Parallel()

	raw := "Here is the summary.\n<compaction>\n" + `{
		"durable_memory": {
			"items": ["User is migrating to Postgres [M1]", "Use pgx [M2]"]
		},
		"rolling_narrative": "Discussed driver choice.",
		"citations": ["M2"]
	}` + "\n</compaction>\nTrailing chatter."

	aliasMap := map[string]string{"M1": "msg_one", "M2": "msg_two"}
	got, err := Parse(raw, aliasMap)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if len(got.DurableMemory.Items) != 2 {
		t.Fatalf("expected 2 memory items, got %v", got.DurableMemory.Items)
	}
	if got.RollingNarrative != "Discussed driver choice." {
		t.Errorf("unexpected narrative %q", got.RollingNarrative)
	}
	// M2 from citations + M1 referenced inline in a fact should both resolve.
	if len(got.Citations) != 2 {
		t.Fatalf("expected 2 citations (M1 inline + M2 listed), got %#v", got.Citations)
	}
	byLabel := map[string]string{}
	for _, c := range got.Citations {
		byLabel[c.Label] = c.MessageID
	}
	if byLabel["M1"] != "msg_one" || byLabel["M2"] != "msg_two" {
		t.Errorf("citation mapping wrong: %#v", byLabel)
	}
}

func TestParseDropsUnknownAliases(t *testing.T) {
	t.Parallel()

	raw := `<compaction>{"durable_memory":{"items":[]},"rolling_narrative":"x","citations":["M9"]}</compaction>`
	got, err := Parse(raw, map[string]string{"M1": "msg_one"})
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	if len(got.Citations) != 0 {
		t.Errorf("expected unknown alias M9 to be dropped, got %#v", got.Citations)
	}
}

func TestParseFallsBackToBareJSON(t *testing.T) {
	t.Parallel()

	raw := "noise {\"durable_memory\":{\"items\":[\"a\"]},\"rolling_narrative\":\"n\",\"citations\":[]} noise"
	got, err := Parse(raw, nil)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	if len(got.DurableMemory.Items) != 1 || got.RollingNarrative != "n" {
		t.Errorf("unexpected parse %#v", got)
	}
}

func TestParseErrorsOnGarbage(t *testing.T) {
	t.Parallel()

	if _, err := Parse("absolutely no json here", nil); err == nil {
		t.Fatal("expected error for non-JSON output")
	}
}

func TestParseNormalisesNilSlices(t *testing.T) {
	t.Parallel()

	raw := `<compaction>{"rolling_narrative":"n"}</compaction>`
	got, err := Parse(raw, nil)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	if got.DurableMemory.Items == nil {
		t.Errorf("expected non-nil items slice, got %#v", got.DurableMemory)
	}
}

func TestCoveredMessageIDsFoldsParentAndDedupes(t *testing.T) {
	t.Parallel()

	prior := &PriorSummary{CoveredMessageIDs: []string{"m1", "m2", "m3"}}
	messages := []InputMessage{
		{MessageID: "m3"}, // overlaps parent, must dedupe
		{MessageID: "m4"},
		{MessageID: "m5"},
	}
	got := CoveredMessageIDs(prior, messages)
	want := []string{"m1", "m2", "m3", "m4", "m5"}
	if len(got) != len(want) {
		t.Fatalf("got %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order mismatch: got %v want %v", got, want)
		}
	}
}

func TestAliasMapSkipsIncompleteEntries(t *testing.T) {
	t.Parallel()

	m := AliasMap([]InputMessage{
		{Alias: "M1", MessageID: "m1"},
		{Alias: "", MessageID: "m2"},
		{Alias: "M3", MessageID: ""},
	})
	if len(m) != 1 || m["M1"] != "m1" {
		t.Errorf("unexpected alias map %#v", m)
	}
}

func TestAssembleSetsMetadataAndLevel(t *testing.T) {
	t.Parallel()

	in := AssembleInput{
		ConversationID:     "conv1",
		AnchorMessageID:    "m5",
		ParentCompactionID: "cmp1",
		Prior:              &PriorSummary{CoveredMessageIDs: []string{"m1", "m2"}},
		Messages:           []InputMessage{{MessageID: "m3"}, {MessageID: "m5"}},
		ModelID:            "model-x",
		OutputMode:         OutputModeDelimitedText,
		CreatedAt:          "2026-06-25T00:00:00Z",
	}
	parsed := ParseResult{RollingNarrative: "n"}
	got := Assemble(in, parsed, 2)

	if got.Version != PayloadVersion || got.Kind != PayloadKind || got.PromptVersion != PromptVersion {
		t.Errorf("constants not set: %#v", got)
	}
	if got.CompactionLevel != 2 || got.ParentCompactionID != "cmp1" {
		t.Errorf("level/parent wrong: level=%d parent=%q", got.CompactionLevel, got.ParentCompactionID)
	}
	if got.Citations == nil {
		t.Error("citations should be non-nil empty slice, not null")
	}
	want := []string{"m1", "m2", "m3", "m5"}
	if len(got.CoveredMessageIDs) != len(want) {
		t.Errorf("covered ids: got %v want %v", got.CoveredMessageIDs, want)
	}
}

func TestEncryptPayloadRoundTrips(t *testing.T) {
	t.Parallel()

	pub, priv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}

	payload := Payload{
		Version:          PayloadVersion,
		Kind:             PayloadKind,
		ConversationID:   "conv1",
		RollingNarrative: "secret summary",
	}
	sealed, err := EncryptPayload(payload, *pub)
	if err != nil {
		t.Fatalf("EncryptPayload: %v", err)
	}

	// Stored value must be ciphertext, not the plaintext summary.
	if containsPlaintext(sealed, "secret summary") {
		t.Fatal("sealed payload leaks plaintext summary")
	}

	ciphertext, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	opened, ok := box.OpenAnonymous(nil, ciphertext, pub, priv)
	if !ok {
		t.Fatal("failed to open sealed box")
	}
	var decoded Payload
	if err := json.Unmarshal(opened, &decoded); err != nil {
		t.Fatalf("unmarshal decrypted payload: %v", err)
	}
	if decoded.RollingNarrative != "secret summary" {
		t.Errorf("round-trip mismatch: %q", decoded.RollingNarrative)
	}
}

func containsPlaintext(haystack, needle string) bool {
	decoded, err := base64.StdEncoding.DecodeString(haystack)
	if err != nil {
		return false
	}
	return string(decoded) != "" && bytesContains(decoded, []byte(needle))
}

func bytesContains(haystack, needle []byte) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		match := true
		for j := range needle {
			if haystack[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
