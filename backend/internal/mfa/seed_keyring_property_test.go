package mfa

import (
	"bytes"
	"encoding/base64"
	"testing"

	"pgregory.net/rapid"
)

// Property: opening with a previous ring member succeeds and signals reseal.
func TestSeedKeyringPreviousKeyOpenProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		prevKey := rapid.SliceOfN(rapid.Byte(), 32, 32).Draw(t, "prevKey")
		primaryKey := rapid.SliceOfN(rapid.Byte(), 32, 32).Draw(t, "primaryKey")
		if bytes.Equal(prevKey, primaryKey) {
			primaryKey[0] ^= 0xFF
		}
		seed := rapid.SliceOfN(rapid.Byte(), 0, 128).Draw(t, "seed")

		prevCipher, err := NewSeedCipher(base64.StdEncoding.EncodeToString(prevKey))
		if err != nil {
			t.Fatalf("NewSeedCipher(prev): %v", err)
		}
		ct, nonce, err := prevCipher.Seal(seed)
		if err != nil {
			t.Fatalf("Seal: %v", err)
		}

		keyring, err := NewSeedKeyring(
			base64.StdEncoding.EncodeToString(primaryKey),
			base64.StdEncoding.EncodeToString(prevKey),
		)
		if err != nil {
			t.Fatalf("NewSeedKeyring: %v", err)
		}

		result, err := keyring.OpenAndReseal(ct, nonce, prevCipher.KeyID())
		if err != nil {
			t.Fatalf("OpenAndReseal: %v", err)
		}
		if !bytes.Equal(result.Seed, seed) {
			t.Fatalf("seed mismatch")
		}
		if !result.NeedsReseal {
			t.Fatal("expected NeedsReseal")
		}
		if result.KeyID != keyring.KeyID() {
			t.Fatalf("KeyID = %q, want primary %q", result.KeyID, keyring.KeyID())
		}
	})
}

// Property: ciphertext sealed under an unknown key must not open.
func TestSeedKeyringRejectsUnknownKeyProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		ringKey := rapid.SliceOfN(rapid.Byte(), 32, 32).Draw(t, "ringKey")
		foreignKey := rapid.SliceOfN(rapid.Byte(), 32, 32).Draw(t, "foreignKey")
		if bytes.Equal(ringKey, foreignKey) {
			foreignKey[0] ^= 0xFF
		}
		seed := rapid.SliceOfN(rapid.Byte(), 0, 128).Draw(t, "seed")

		foreign, err := NewSeedCipher(base64.StdEncoding.EncodeToString(foreignKey))
		if err != nil {
			t.Fatalf("NewSeedCipher(foreign): %v", err)
		}
		ct, nonce, err := foreign.Seal(seed)
		if err != nil {
			t.Fatalf("Seal: %v", err)
		}

		keyring, err := NewSeedKeyring(base64.StdEncoding.EncodeToString(ringKey))
		if err != nil {
			t.Fatalf("NewSeedKeyring: %v", err)
		}
		if _, err := keyring.OpenAndReseal(ct, nonce, foreign.KeyID()); err == nil {
			t.Fatal("OpenAndReseal with foreign key succeeded")
		}
	})
}
