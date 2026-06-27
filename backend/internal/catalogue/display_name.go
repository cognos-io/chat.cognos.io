package catalogue

import (
	"regexp"
	"strings"
)

var (
	// Provider/API hints in parentheses, e.g. "(Bedrock)", "(Responses)".
	displayParenGroup = regexp.MustCompile(`\s*\([^)]*\)`)
	// Technical tokens that mean nothing to non-technical users: quantization
	// (FP8/BF16/…), MoE active-parameter tags (A22B), instruction-tuning tags
	// (Instruct/IT) and date stamps (2507). Family, size (70B) and version are
	// deliberately kept so models stay distinguishable.
	displayNoiseToken = regexp.MustCompile(`(?i)\b(fp8|fp16|fp4|bf16|int8|int4|awq|gptq|a\d+b|instruct|it|\d{4})\b`)
	displayMultiSpace = regexp.MustCompile(`\s{2,}`)
)

// FriendlyModelName derives a user-facing display name from a catalogue model
// name by stripping technical noise. It is deterministic so it can both backfill
// existing rows and provide a sensible default for new ones. Returns the trimmed
// original if stripping would leave nothing.
func FriendlyModelName(name string) string {
	out := displayParenGroup.ReplaceAllString(name, "")
	out = displayNoiseToken.ReplaceAllString(out, "")
	out = displayMultiSpace.ReplaceAllString(out, " ")
	out = strings.TrimSpace(out)
	if out == "" {
		return strings.TrimSpace(name)
	}
	return out
}
