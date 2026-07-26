package oauth

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"

	"github.com/pocketbase/pocketbase/tools/security"
)

const tokenLength = 43 // ~256 bits from PocketBase's 62-char alphabet

// NewToken returns a fresh opaque token (raw, return-once).
func NewToken() string { return security.RandomString(tokenLength) }

// Hash returns the hex-encoded SHA-256 of a raw token for storage.
func Hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// HashEqual compares a raw token to a stored hash in constant time.
func HashEqual(rawToken, storedHash string) bool {
	return subtle.ConstantTimeCompare([]byte(Hash(rawToken)), []byte(storedHash)) == 1
}
