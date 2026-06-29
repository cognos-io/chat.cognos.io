package mfa

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"testing"
)

func newTestKeyB64(t *testing.T) string {
	t.Helper()
	raw := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		t.Fatalf("read random key: %v", err)
	}
	return base64.StdEncoding.EncodeToString(raw)
}

func TestNewSeedCipher(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		key     string
		wantErr error
	}{
		{name: "empty key disables enrolment", key: "", wantErr: ErrSeedCipherUnavailable},
		{name: "not base64", key: "!!!not-base64!!!", wantErr: nil /* some error */},
		{name: "wrong length", key: base64.StdEncoding.EncodeToString([]byte("too-short")), wantErr: nil},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewSeedCipher(tc.key)
			if err == nil {
				t.Fatalf("expected an error for %q", tc.name)
			}
			if tc.wantErr != nil && !errors.Is(err, tc.wantErr) {
				t.Fatalf("want %v, got %v", tc.wantErr, err)
			}
		})
	}

	t.Run("valid key", func(t *testing.T) {
		if _, err := NewSeedCipher(newTestKeyB64(t)); err != nil {
			t.Fatalf("valid key should succeed: %v", err)
		}
	})
}

func TestSeedCipherRoundTrip(t *testing.T) {
	t.Parallel()

	cipher, err := NewSeedCipher(newTestKeyB64(t))
	if err != nil {
		t.Fatal(err)
	}

	seed := []byte("JBSWY3DPEHPK3PXP") // a representative base32 TOTP seed
	ct, nonce, err := cipher.Seal(seed)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if ct == "" || nonce == "" {
		t.Fatal("seal produced empty ciphertext or nonce")
	}
	if ct == base64.StdEncoding.EncodeToString(seed) {
		t.Fatal("ciphertext must not equal the plaintext seed")
	}

	got, err := cipher.Open(ct, nonce)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if string(got) != string(seed) {
		t.Fatalf("round-trip mismatch: want %q got %q", seed, got)
	}
}

func TestSeedCipherRejectsWrongKey(t *testing.T) {
	t.Parallel()

	a, _ := NewSeedCipher(newTestKeyB64(t))
	b, _ := NewSeedCipher(newTestKeyB64(t))

	ct, nonce, err := a.Seal([]byte("secret-seed"))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := b.Open(ct, nonce); err == nil {
		t.Fatal("opening with a different key must fail")
	}
}

func TestSeedCipherDetectsTampering(t *testing.T) {
	t.Parallel()

	cipher, _ := NewSeedCipher(newTestKeyB64(t))
	ct, nonce, _ := cipher.Seal([]byte("secret-seed"))

	// Flip a byte in the ciphertext.
	raw, _ := base64.StdEncoding.DecodeString(ct)
	raw[0] ^= 0xff
	tampered := base64.StdEncoding.EncodeToString(raw)

	if _, err := cipher.Open(tampered, nonce); err == nil {
		t.Fatal("tampered ciphertext must fail authentication")
	}
}

func TestSeedCipherKeyID(t *testing.T) {
	t.Parallel()

	key := newTestKeyB64(t)
	a, _ := NewSeedCipher(key)
	b, _ := NewSeedCipher(key)
	if a.KeyID() != b.KeyID() {
		t.Fatal("same key must yield the same key id")
	}

	other, _ := NewSeedCipher(newTestKeyB64(t))
	if a.KeyID() == other.KeyID() {
		t.Fatal("different keys must yield different key ids (rotation detection)")
	}
}
