package requestysync

import (
	"reflect"
	"testing"
)

func TestNormalizeIDStripsRegionAndCase(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"azure/o4-mini@swedencentral":  "azure/o4-mini",
		"azure/o4-mini@eastus2":        "azure/o4-mini",
		"Azure/GPT-5-Mini":             "azure/gpt-5-mini",
		"nebius/qwen/qwen3-32b":        "nebius/qwen/qwen3-32b",
		"  bedrock/claude@eu-central ": "bedrock/claude",
		"":                             "",
	}
	for in, want := range cases {
		if got := NormalizeID(in); got != want {
			t.Errorf("NormalizeID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeIDMatchesAcrossRegions(t *testing.T) {
	t.Parallel()
	// Our curated id (swedencentral) must match Requesty's (eastus2).
	if NormalizeID("azure/o4-mini@swedencentral") != NormalizeID("azure/o4-mini@eastus2") {
		t.Fatal("region-suffixed ids for the same base model must normalise equal")
	}
}

func TestReasoningEffortsForOnlyWhenSupported(t *testing.T) {
	t.Parallel()

	efforts, def := reasoningEffortsFor(RequestyModel{SupportsReasoning: true})
	if !reflect.DeepEqual(efforts, []string{"off", "low", "medium", "high"}) || def != "medium" {
		t.Fatalf("supported reasoning = %v / %q, want standard set / medium", efforts, def)
	}

	efforts, def = reasoningEffortsFor(RequestyModel{SupportsReasoning: false})
	if efforts != nil || def != "" {
		t.Fatalf("non-reasoning model = %v / %q, want nil / empty", efforts, def)
	}
}

func TestImageGenerationEnabledRequiresFlagAndTransport(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		supports  bool
		transport string
		want      bool
	}{
		{"flag and transport", true, "chat_completions", true},
		{"flag but no transport stays off", true, "  ", false},
		{"transport but Requesty says no", false, "images_api", false},
		{"neither", false, "", false},
	}
	for _, tc := range cases {
		got := imageGenerationEnabled(
			RequestyModel{SupportsImageGeneration: tc.supports},
			tc.transport,
		)
		if got != tc.want {
			t.Errorf("%s: imageGenerationEnabled(%v, %q) = %v, want %v",
				tc.name, tc.supports, tc.transport, got, tc.want)
		}
	}
}

func TestPerMillionConvertsPerTokenPrice(t *testing.T) {
	t.Parallel()
	if got := perMillion(0.0000011); got != 1.1 {
		t.Fatalf("perMillion(0.0000011) = %v, want 1.1", got)
	}
}

func TestIndexDedupesByNormalisedID(t *testing.T) {
	t.Parallel()
	byID := index([]RequestyModel{
		{ID: "azure/o4-mini@swedencentral", ContextWindow: 200000},
		{ID: "azure/o4-mini@eastus2", ContextWindow: 999},
	})
	if len(byID) != 1 {
		t.Fatalf("len(index) = %d, want 1", len(byID))
	}
	if byID["azure/o4-mini"].ContextWindow != 200000 {
		t.Fatalf("first entry should win, got context %d", byID["azure/o4-mini"].ContextWindow)
	}
}
