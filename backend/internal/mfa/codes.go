package mfa

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/pocketbase/pocketbase/tools/security"
)

const (
	// sessionTokenLength / deviceTokenLength are URL-safe random strings with
	// ample entropy (PocketBase's RandomString draws from a 62-char alphabet, so
	// 43 chars ≈ 256 bits). These are opaque bearer tokens; only their hash is
	// stored.
	sessionTokenLength = 43
	deviceTokenLength  = 43

	// RecoveryCodeCount / recoveryCodeBytes: ten codes, each 20 random base32-ish
	// characters (~100+ bits). Codes are shown once and stored only as hashes.
	RecoveryCodeCount = 10
	recoveryCodeChars = 10 // chars per group
)

// recoveryAlphabet excludes ambiguous characters (0/O, 1/I/L) so codes are easy
// to read and transcribe off a recovery sheet.
const recoveryAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// NewSessionToken returns a fresh opaque MFA-session token (raw, return-once).
func NewSessionToken() string { return security.RandomString(sessionTokenLength) }

// NewDeviceToken returns a fresh opaque trusted-device token (raw, return-once).
func NewDeviceToken() string { return security.RandomString(deviceTokenLength) }

// Hash returns the hex SHA-256 of a token. Used for all MFA bearer tokens
// (sessions, trusted devices, recovery codes). A fast hash is sufficient here
// because every hashed value is high-entropy random material, not a
// user-chosen low-entropy secret — there is nothing to brute force.
func Hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// HashEqual reports whether a raw token matches a stored hash, in constant time.
func HashEqual(rawToken, storedHash string) bool {
	return constantTimeEqual(Hash(rawToken), storedHash)
}

// GenerateRecoveryCodes returns n human-readable recovery codes (formatted as
// XXXXX-XXXXX) alongside their hashes for storage. The plaintext is shown to
// the user once and never persisted.
func GenerateRecoveryCodes(n int) (plain []string, hashes []string) {
	plain = make([]string, 0, n)
	hashes = make([]string, 0, n)
	for i := 0; i < n; i++ {
		code := formatRecoveryCode(security.RandomStringWithAlphabet(recoveryCodeChars, recoveryAlphabet))
		plain = append(plain, code)
		hashes = append(hashes, Hash(NormalizeRecoveryCode(code)))
	}
	return plain, hashes
}

// formatRecoveryCode renders a raw 10-char string as XXXXX-XXXXX for display.
func formatRecoveryCode(raw string) string {
	if len(raw) != recoveryCodeChars {
		return raw
	}
	return raw[:5] + "-" + raw[5:]
}

// NormalizeRecoveryCode canonicalises user input before hashing/lookup: strip
// dashes and whitespace, uppercase. So "abcde-fghjk", "ABCDEFGHJK", and
// "abcde fghjk" all match the same stored hash.
func NormalizeRecoveryCode(input string) string {
	var b strings.Builder
	for _, r := range input {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r - 32)
		case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
		}
	}
	return b.String()
}
