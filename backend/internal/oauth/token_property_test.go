package oauth

import (
	"encoding/hex"
	"testing"

	"pgregory.net/rapid"
)

// Property: Hash is deterministic and always returns 64 hex chars (SHA-256).
// Tokens are high-entropy; the hash is what we store, so collisions on the
// hex encoding would break look-ups.
func TestHashDeterministicHexProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		raw := rapid.StringN(1, 128, 256).Draw(t, "raw")
		a := Hash(raw)
		b := Hash(raw)
		if a != b {
			t.Fatalf("Hash not deterministic: %q vs %q", a, b)
		}
		if len(a) != 64 {
			t.Fatalf("Hash length = %d, want 64", len(a))
		}
		if _, err := hex.DecodeString(a); err != nil {
			t.Fatalf("Hash(%q) = %q is not hex: %v", raw, a, err)
		}
	})
}

// Property: HashEqual accepts only the matching raw token (and rejects
// empty / different inputs). Pins the constant-time compare contract used
// by step-up and link-intent consumption.
func TestHashEqualProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		raw := rapid.StringN(8, 64, 128).Draw(t, "raw")
		stored := Hash(raw)
		if !HashEqual(raw, stored) {
			t.Fatalf("HashEqual rejected matching token")
		}
		other := rapid.StringN(8, 64, 128).Filter(func(s string) bool {
			return s != raw
		}).Draw(t, "other")
		if HashEqual(other, stored) {
			t.Fatalf("HashEqual accepted a different token")
		}
		if HashEqual("", stored) {
			t.Fatalf("HashEqual accepted empty token")
		}
	})
}

// Property: NewToken returns the expected length and never collides across
// a small sample in one check (birthday bound is tiny; this is a smoke pin).
func TestNewTokenLengthProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		n := rapid.IntRange(2, 8).Draw(t, "n")
		seen := make(map[string]struct{}, n)
		for range n {
			tok := NewToken()
			if len(tok) != tokenLength {
				t.Fatalf("NewToken length = %d, want %d", len(tok), tokenLength)
			}
			if _, ok := seen[tok]; ok {
				t.Fatalf("NewToken collision: %q", tok)
			}
			seen[tok] = struct{}{}
		}
	})
}
