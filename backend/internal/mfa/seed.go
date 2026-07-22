// Package mfa implements the server-side primitives for authenticator-app
// (TOTP) multi-factor authentication: encrypting TOTP seeds at rest with a
// server-held key, generating and verifying time-based codes, and minting and
// hashing the one-use tokens behind MFA sessions, recovery codes, and trusted
// devices. See docs/business_processes/mfa-login.md.
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
	"strings"

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

// SeedKeyring holds the active TOTP seed encryption key plus any previous keys
// still needed to open rows sealed before rotation. Seal always uses the primary;
// Open tries the stored secret_key_id first, then other ring members.
type SeedKeyring struct {
	primary *SeedCipher
	byID    map[string]*SeedCipher
}

// ParseTOTPEncryptionKeysList splits a comma-separated list of base64 keys
// (empty entries are ignored). Used for mfa.totp_encryption_key_previous.
func ParseTOTPEncryptionKeysList(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// NewSeedKeyring builds a keyring from the primary key and zero or more previous
// keys. An empty primary yields ErrSeedCipherUnavailable. Malformed previous keys
// are a hard error so a typo cannot silently strand enrolled seeds.
func NewSeedKeyring(primaryB64 string, previousB64 ...string) (*SeedKeyring, error) {
	primary, err := NewSeedCipher(primaryB64)
	if err != nil {
		return nil, err
	}

	kr := &SeedKeyring{
		primary: primary,
		byID:    map[string]*SeedCipher{primary.KeyID(): primary},
	}

	for _, prev := range previousB64 {
		prev = strings.TrimSpace(prev)
		if prev == "" {
			continue
		}
		c, err := NewSeedCipher(prev)
		if err != nil {
			return nil, fmt.Errorf("mfa: invalid previous TOTP encryption key: %w", err)
		}
		kr.byID[c.KeyID()] = c
	}

	return kr, nil
}

// KeyID identifies the primary key (used when sealing new seeds).
func (k *SeedKeyring) KeyID() string { return k.primary.KeyID() }

// Seal encrypts a TOTP seed with the primary key.
func (k *SeedKeyring) Seal(seed []byte) (ciphertextB64, nonceB64 string, err error) {
	return k.primary.Seal(seed)
}

// OpenResult is returned by OpenAndReseal. When NeedsReseal is true the opened
// seed was encrypted with a non-primary key and the caller should persist the
// re-sealed fields on the TOTP row.
type OpenResult struct {
	Seed        []byte
	NeedsReseal bool
	Ciphertext  string
	Nonce       string
	KeyID       string
}

// OpenAndReseal decrypts a sealed TOTP seed and, when it was opened with a
// non-primary key, returns freshly sealed ciphertext under the primary.
func (k *SeedKeyring) OpenAndReseal(ciphertextB64, nonceB64, storedKeyID string) (OpenResult, error) {
	seed, usedKeyID, err := k.open(ciphertextB64, nonceB64, storedKeyID)
	if err != nil {
		return OpenResult{}, err
	}

	result := OpenResult{Seed: seed}
	if usedKeyID != k.primary.KeyID() {
		ct, nonce, err := k.primary.Seal(seed)
		if err != nil {
			return OpenResult{}, err
		}
		result.NeedsReseal = true
		result.Ciphertext = ct
		result.Nonce = nonce
		result.KeyID = k.primary.KeyID()
	}
	return result, nil
}

func (k *SeedKeyring) open(ciphertextB64, nonceB64, storedKeyID string) ([]byte, string, error) {
	order := k.openOrder(storedKeyID)
	var lastErr error
	for _, c := range order {
		seed, err := c.Open(ciphertextB64, nonceB64)
		if err == nil {
			return seed, c.KeyID(), nil
		}
		lastErr = err
	}
	if lastErr != nil {
		return nil, "", lastErr
	}
	return nil, "", errors.New("mfa: failed to decrypt TOTP seed")
}

func (k *SeedKeyring) openOrder(storedKeyID string) []*SeedCipher {
	seen := make(map[string]struct{}, len(k.byID))
	order := make([]*SeedCipher, 0, len(k.byID))

	if storedKeyID != "" {
		if c, ok := k.byID[storedKeyID]; ok {
			order = append(order, c)
			seen[c.KeyID()] = struct{}{}
		}
	}
	if _, ok := seen[k.primary.KeyID()]; !ok {
		order = append(order, k.primary)
		seen[k.primary.KeyID()] = struct{}{}
	}
	for id, c := range k.byID {
		if _, ok := seen[id]; !ok {
			order = append(order, c)
		}
	}
	return order
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
