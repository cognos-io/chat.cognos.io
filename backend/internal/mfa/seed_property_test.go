package mfa

import (
	"bytes"
	"encoding/base64"
	"testing"

	"pgregory.net/rapid"
)

// Property: sealing and reopening a TOTP seed is a lossless round-trip for any
// payload the enrolment flow could realistically store, and the key id is
// stable for the same key material. This pins the at-rest encryption contract.
func TestSeedCipherRoundTripProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		key := rapid.SliceOfN(rapid.Byte(), 32, 32).Draw(t, "key")
		seed := rapid.SliceOfN(rapid.Byte(), 0, 4096).Draw(t, "seed")

		cipher, err := NewSeedCipher(base64.StdEncoding.EncodeToString(key))
		if err != nil {
			t.Fatalf("NewSeedCipher: %v", err)
		}

		ciphertext, nonce, err := cipher.Seal(seed)
		if err != nil {
			t.Fatalf("Seal: %v", err)
		}
		got, err := cipher.Open(ciphertext, nonce)
		if err != nil {
			t.Fatalf("Open: %v", err)
		}
		if !bytes.Equal(got, seed) {
			t.Fatalf("Open(Seal(seed)) = %x, want %x", got, seed)
		}

		cipherAgain, err := NewSeedCipher(base64.StdEncoding.EncodeToString(key))
		if err != nil {
			t.Fatalf("NewSeedCipher (repeat): %v", err)
		}
		if cipher.KeyID() != cipherAgain.KeyID() {
			t.Fatalf("KeyID = %q, want stable %q", cipher.KeyID(), cipherAgain.KeyID())
		}
	})
}

// Property: decrypting with the wrong key must fail. If this ever passes, the
// MFA seed storage would have stopped authenticating ciphertexts.
func TestSeedCipherRejectsWrongKeyProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		key := rapid.SliceOfN(rapid.Byte(), 32, 32).Draw(t, "key")
		wrongKey := rapid.SliceOfN(rapid.Byte(), 32, 32).Draw(t, "wrongKey")
		if bytes.Equal(key, wrongKey) {
			wrongKey[0] ^= 0xFF
		}
		seed := rapid.SliceOfN(rapid.Byte(), 0, 128).Draw(t, "seed")

		cipher, err := NewSeedCipher(base64.StdEncoding.EncodeToString(key))
		if err != nil {
			t.Fatalf("NewSeedCipher: %v", err)
		}
		ciphertext, nonce, err := cipher.Seal(seed)
		if err != nil {
			t.Fatalf("Seal: %v", err)
		}

		wrongCipher, err := NewSeedCipher(base64.StdEncoding.EncodeToString(wrongKey))
		if err != nil {
			t.Fatalf("NewSeedCipher(wrong): %v", err)
		}
		if _, err := wrongCipher.Open(ciphertext, nonce); err == nil {
			t.Fatalf("Open with wrong key succeeded for seed length %d", len(seed))
		}
	})
}

// Property: any single-byte change to the ciphertext must fail authentication.
func TestSeedCipherRejectsTamperedCiphertextProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		key := rapid.SliceOfN(rapid.Byte(), 32, 32).Draw(t, "key")
		seed := rapid.SliceOfN(rapid.Byte(), 0, 128).Draw(t, "seed")

		cipher, err := NewSeedCipher(base64.StdEncoding.EncodeToString(key))
		if err != nil {
			t.Fatalf("NewSeedCipher: %v", err)
		}
		ciphertext, nonce, err := cipher.Seal(seed)
		if err != nil {
			t.Fatalf("Seal: %v", err)
		}

		sealed, err := base64.StdEncoding.DecodeString(ciphertext)
		if err != nil {
			t.Fatalf("DecodeString(ciphertext): %v", err)
		}
		if len(sealed) == 0 {
			t.Fatal("sealed ciphertext unexpectedly empty")
		}
		tamperAt := rapid.IntRange(0, len(sealed)-1).Draw(t, "tamperAt")
		sealed[tamperAt] ^= 0x01

		tampered := base64.StdEncoding.EncodeToString(sealed)
		if _, err := cipher.Open(tampered, nonce); err == nil {
			t.Fatalf("Open succeeded for tampered ciphertext (byte %d)", tamperAt)
		}
	})
}
