package mfa

import (
	"testing"

	"pgregory.net/rapid"
)

// Property: recovery-code normalisation is idempotent and only emits the
// allowed uppercase alphabet plus digits. That makes lookups stable regardless
// of the user's spacing or case.
func TestNormalizeRecoveryCodeProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		input := rapid.StringN(0, 64, 128).Draw(t, "input")
		got := NormalizeRecoveryCode(input)
		again := NormalizeRecoveryCode(got)

		if got != again {
			t.Fatalf("NormalizeRecoveryCode(%q) = %q, but a second pass produced %q", input, got, again)
		}
		for _, r := range got {
			switch {
			case r >= 'A' && r <= 'Z':
			case r >= '0' && r <= '9':
			default:
				t.Fatalf("NormalizeRecoveryCode(%q) = %q, contains disallowed rune %q", input, got, r)
			}
		}
	})
}

// Property: formatting a valid 10-character recovery code and then
// normalising it must return the original raw code. This pins the display
// format and canonical hash input together.
func TestRecoveryCodeFormatRoundTripProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		rawBytes := rapid.SliceOfN(rapid.SampledFrom([]byte(recoveryAlphabet)), recoveryCodeChars, recoveryCodeChars).Draw(t, "raw")
		raw := string(rawBytes)
		formatted := formatRecoveryCode(raw)

		if got := NormalizeRecoveryCode(formatted); got != raw {
			t.Fatalf("NormalizeRecoveryCode(formatRecoveryCode(%q)) = %q, want %q", raw, got, raw)
		}
	})
}
