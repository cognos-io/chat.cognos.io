package requestysync

import (
	"strings"
	"testing"

	"pgregory.net/rapid"
)

// Property: normalising a Requesty model ID lowercases, trims, and strips the
// region suffix without changing the base id. Different regions for the same
// base model therefore resolve to the same key.
func TestNormalizeIDProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		base := rapid.StringMatching(`[A-Za-z0-9._/-]{1,16}`).Draw(t, "base")
		suffix := rapid.StringMatching(`[A-Za-z0-9._/-]{0,12}`).Draw(t, "suffix")
		prefix := rapid.SampledFrom([]string{"", " ", "\t", "\n"}).Draw(t, "prefix")
		trailer := rapid.SampledFrom([]string{"", " ", "\t", "\n"}).Draw(t, "trailer")

		withSuffix := prefix + base + "@" + suffix + trailer
		withoutSuffix := prefix + base + trailer

		got := NormalizeID(withSuffix)
		want := strings.ToLower(strings.TrimSpace(base))
		if got != want {
			t.Fatalf("NormalizeID(%q) = %q, want %q", withSuffix, got, want)
		}
		if NormalizeID(withSuffix) != NormalizeID(withoutSuffix) {
			t.Fatalf("NormalizeID changed across suffixes: %q vs %q", withSuffix, withoutSuffix)
		}
		if NormalizeID(got) != got {
			t.Fatalf("NormalizeID is not idempotent for %q", got)
		}
		if strings.Contains(got, "@") {
			t.Fatalf("NormalizeID(%q) = %q, want no @", withSuffix, got)
		}
	})
}
