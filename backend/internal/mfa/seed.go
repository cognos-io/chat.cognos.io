// Package mfa implements the server-side primitives for authenticator-app
// (TOTP) multi-factor authentication: encrypting TOTP seeds at rest with a
// server-held key, generating and verifying time-based codes, and minting and
// hashing the one-use tokens behind MFA sessions, recovery codes, and trusted
// devices. See docs/specs/mfa-and-passkeys.md.
//
// Nothing here logs secrets: seeds, codes, and tokens are never written to logs
// or returned in errors.
package mfa

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"

	"golang.org/x/crypto/nacl/secretbox"

	"github.com/cognos-io/chat.cognos.io/backend/internal/crypto"
)

// ErrSeedCipherUnavailable is returned when TOTP enrolment is attempted but no
// server encryption key is configured. We never fall back to plaintext seeds.
var ErrSeedCipherUnavailable = errors.New("mfa: TOTP encryption key not configured")

// SeedCipher seals and opens TOTP seeds with a server-held symmetric key
// (NaCl secretbox). The key lives in config (MFA_TOTP_ENCRYPTION_KEY), not in
// the database, so a database leak alone never exposes a usable seed.
type SeedCipher struct {
	keyID string
	key   [32]byte
}

// NewSeedCipher builds a cipher from a base64-encoded 32-byte key. The key id
// is derived from the key itself (a short hash), so rotating to a new key
// automatically stamps a new secret_key_id on freshly sealed seeds and old
// rows remain identifiable. An empty key yields ErrSeedCipherUnavailable so the
// caller can disable enrolment cleanly.
func NewSeedCipher(b64Key string) (*SeedCipher, error) {
	if b64Key == "" {
		return nil, ErrSeedCipherUnavailable
	}

	raw, err := base64.StdEncoding.DecodeString(b64Key)
	if err != nil {
		return nil, fmt.Errorf("mfa: decode TOTP encryption key: %w", err)
	}
	if len(raw) != 32 {
		return nil, fmt.Errorf("mfa: TOTP encryption key must be 32 bytes, got %d", len(raw))
	}

	c := &SeedCipher{}
	copy(c.key[:], raw)

	sum := sha256.Sum256(raw)
	c.keyID = "k_" + hex.EncodeToString(sum[:4])

	return c, nil
}

// KeyID identifies the key that sealed a seed, recorded as secret_key_id so a
// future rotation can tell which rows used which key.
func (c *SeedCipher) KeyID() string { return c.keyID }

// Seal encrypts a TOTP seed, returning the base64 ciphertext and nonce to store
// in separate columns.
func (c *SeedCipher) Seal(seed []byte) (ciphertextB64, nonceB64 string, err error) {
	nonce, err := crypto.NewNonce()
	if err != nil {
		return "", "", err
	}

	// secretbox.Seal prepends nothing here — we keep the nonce in its own column.
	sealed := secretbox.Seal(nil, seed, &nonce, &c.key)

	return base64.StdEncoding.EncodeToString(sealed),
		base64.StdEncoding.EncodeToString(nonce[:]),
		nil
}

// Open decrypts a sealed TOTP seed.
func (c *SeedCipher) Open(ciphertextB64, nonceB64 string) ([]byte, error) {
	sealed, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return nil, fmt.Errorf("mfa: decode seed ciphertext: %w", err)
	}
	rawNonce, err := base64.StdEncoding.DecodeString(nonceB64)
	if err != nil {
		return nil, fmt.Errorf("mfa: decode seed nonce: %w", err)
	}
	if len(rawNonce) != 24 {
		return nil, errors.New("mfa: invalid seed nonce length")
	}

	var nonce [24]byte
	copy(nonce[:], rawNonce)

	seed, ok := secretbox.Open(nil, sealed, &nonce, &c.key)
	if !ok {
		return nil, errors.New("mfa: failed to decrypt TOTP seed")
	}
	return seed, nil
}

// constantTimeEqual reports whether two strings are equal without leaking their
// contents through timing. Used when comparing hashes.
func constantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
