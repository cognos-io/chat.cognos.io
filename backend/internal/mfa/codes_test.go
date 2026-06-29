package mfa

import (
	"regexp"
	"testing"
)

func TestGenerateRecoveryCodes(t *testing.T) {
	t.Parallel()

	plain, hashes := GenerateRecoveryCodes(RecoveryCodeCount)
	if len(plain) != RecoveryCodeCount || len(hashes) != RecoveryCodeCount {
		t.Fatalf("want %d codes, got %d plain / %d hashes", RecoveryCodeCount, len(plain), len(hashes))
	}

	format := regexp.MustCompile(`^[A-Z2-9]{5}-[A-Z2-9]{5}$`)
	seen := map[string]bool{}
	for i, code := range plain {
		if !format.MatchString(code) {
			t.Errorf("code %q is not in XXXXX-XXXXX format", code)
		}
		if seen[code] {
			t.Errorf("duplicate recovery code generated: %q", code)
		}
		seen[code] = true

		// The stored hash must match the normalised plaintext, and must not be
		// the plaintext itself.
		if hashes[i] == code {
			t.Errorf("hash must not equal plaintext for %q", code)
		}
		if !HashEqual(NormalizeRecoveryCode(code), hashes[i]) {
			t.Errorf("hash for %q does not verify against normalised input", code)
		}
	}
}

func TestNormalizeRecoveryCode(t *testing.T) {
	t.Parallel()

	tests := []struct {
		in, want string
	}{
		{"ABCDE-FGHJK", "ABCDEFGHJK"},
		{"abcde-fghjk", "ABCDEFGHJK"},
		{"abcde fghjk", "ABCDEFGHJK"},
		{"  ABCDE-FGHJK  ", "ABCDEFGHJK"},
		{"AB2DE-FGH9K", "AB2DEFGH9K"},
	}
	for _, tc := range tests {
		if got := NormalizeRecoveryCode(tc.in); got != tc.want {
			t.Errorf("Normalize(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestHashEqual(t *testing.T) {
	t.Parallel()

	token := NewSessionToken()
	hash := Hash(token)

	if !HashEqual(token, hash) {
		t.Fatal("a token must verify against its own hash")
	}
	if HashEqual(token+"x", hash) {
		t.Fatal("a different token must not verify")
	}
	if HashEqual("", hash) {
		t.Fatal("empty token must not verify")
	}
}

func TestTokensAreUniqueAndHighEntropy(t *testing.T) {
	t.Parallel()

	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		for _, token := range []string{NewSessionToken(), NewDeviceToken()} {
			if len(token) < 32 {
				t.Fatalf("token too short to be high-entropy: %d chars", len(token))
			}
			if seen[token] {
				t.Fatalf("token collision: %q", token)
			}
			seen[token] = true
		}
	}
}
