package catalogue

import "testing"

import "pgregory.net/rapid"

// Property: normalising privacy tiers never invents a new value, and the tier
// lattice matches the documented access rules.
func TestPrivacyTierProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		raw := rapid.SampledFrom([]string{"ch_only", "eu", "global", "legacy", "", "unknown"}).Draw(t, "raw")
		got := NormalizePrivacyTier(raw)
		switch raw {
		case "ch_only":
			if got != PrivacyTierCHOnly {
				t.Fatalf("NormalizePrivacyTier(%q) = %q, want %q", raw, got, PrivacyTierCHOnly)
			}
		case "eu", "", "legacy", "unknown":
			if got != PrivacyTierEU {
				t.Fatalf("NormalizePrivacyTier(%q) = %q, want %q", raw, got, PrivacyTierEU)
			}
		case "global":
			if got != PrivacyTierGlobal {
				t.Fatalf("NormalizePrivacyTier(%q) = %q, want %q", raw, got, PrivacyTierGlobal)
			}
		}

		userTier := rapid.SampledFrom([]PrivacyTier{PrivacyTierCHOnly, PrivacyTierEU, PrivacyTierGlobal}).Draw(t, "userTier")
		modelTier := rapid.SampledFrom([]PrivacyTier{PrivacyTierCHOnly, PrivacyTierEU, PrivacyTierGlobal}).Draw(t, "modelTier")
		eligible := IsEligibleForTier(userTier, modelTier)

		switch userTier {
		case PrivacyTierCHOnly:
			if eligible != (modelTier == PrivacyTierCHOnly) {
				t.Fatalf("IsEligibleForTier(%q, %q) = %t, want model tier ch_only only", userTier, modelTier, eligible)
			}
		case PrivacyTierEU:
			if eligible != (modelTier == PrivacyTierCHOnly || modelTier == PrivacyTierEU) {
				t.Fatalf("IsEligibleForTier(%q, %q) = %t, want ch_only or eu", userTier, modelTier, eligible)
			}
		case PrivacyTierGlobal:
			if !eligible {
				t.Fatalf("IsEligibleForTier(%q, %q) = false, want true", userTier, modelTier)
			}
		}
	})
}
