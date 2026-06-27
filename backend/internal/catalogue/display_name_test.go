package catalogue

import "testing"

func TestFriendlyModelName(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"Llama 3.3 70B Instruct":        "Llama 3.3 70B",
		"Gemma 3 27B IT":                "Gemma 3 27B",
		"Qwen3 235B A22B Instruct 2507": "Qwen3 235B",
		"Qwen3.5 122B A10B FP8":         "Qwen3.5 122B",
		"GPT-OSS 120B":                  "GPT-OSS 120B",
		"Qwen3 Next 80B A3B Thinking":   "Qwen3 Next 80B Thinking",
		"Claude Opus 4.8":               "Claude Opus 4.8",
		"Gemini 2.5 Flash Image":        "Gemini 2.5 Flash Image",
		"GPT-4.1 Nano (Responses)":      "GPT-4.1 Nano",
		"GPT-5.5 (Responses)":           "GPT-5.5",
		"GPT-4o Mini":                   "GPT-4o Mini",
		"o4 Mini":                       "o4 Mini",
		"MiniMax M2.5":                  "MiniMax M2.5",
		"Claude Sonnet 4.6 (Bedrock)":   "Claude Sonnet 4.6",
	}

	for input, want := range cases {
		if got := FriendlyModelName(input); got != want {
			t.Errorf("FriendlyModelName(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestFriendlyModelNameFallsBackWhenEmptied(t *testing.T) {
	t.Parallel()
	if got := FriendlyModelName("FP8 (Bedrock)"); got != "FP8 (Bedrock)" {
		t.Errorf("expected fallback to original, got %q", got)
	}
}
