package chat

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"testing"

	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/secretbox"
)

// TestEncryptAttachmentRoundTrip proves the server can encrypt attachment bytes
// to a conversation public key and a holder of the conversation secret key (the
// client) can recover them — without the server ever needing the secret key.
func TestEncryptAttachmentRoundTrip(t *testing.T) {
	t.Parallel()

	// The conversation keypair. Only the public key is available server-side.
	conversationPublicKey, conversationSecretKey, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate conversation keypair: %v", err)
	}

	plaintext := []byte("\x89PNG\r\n\x1a\n pretend these are decrypted image bytes")

	// Server side: encrypt with the public key only.
	att, err := EncryptAttachment(plaintext, *conversationPublicKey)
	if err != nil {
		t.Fatalf("EncryptAttachment: %v", err)
	}
	if bytes.Contains(att.Ciphertext, plaintext) {
		t.Fatal("ciphertext contains the plaintext bytes")
	}

	// Client side: unseal the per-attachment symmetric key, then open the file.
	sealedKey, err := base64.StdEncoding.DecodeString(att.SealedKeyB64)
	if err != nil {
		t.Fatalf("decode sealed key: %v", err)
	}
	keyBytes, ok := box.OpenAnonymous(nil, sealedKey, conversationPublicKey, conversationSecretKey)
	if !ok {
		t.Fatal("failed to open sealed symmetric key")
	}
	if len(keyBytes) != 32 {
		t.Fatalf("symmetric key length = %d, want 32", len(keyBytes))
	}

	var symmetricKey [32]byte
	copy(symmetricKey[:], keyBytes)

	// crypto.SymmetricEncrypt prepends the 24-byte nonce to the secretbox output.
	var nonce [24]byte
	copy(nonce[:], att.Ciphertext[:24])
	decrypted, ok := secretbox.Open(nil, att.Ciphertext[24:], &nonce, &symmetricKey)
	if !ok {
		t.Fatal("failed to open attachment ciphertext")
	}

	if !bytes.Equal(decrypted, plaintext) {
		t.Fatal("decrypted attachment does not match original")
	}
}

// TestEncryptAttachmentUsesFreshKeyPerCall guards against accidental key reuse:
// two encryptions of the same bytes must not produce identical ciphertext.
func TestEncryptAttachmentUsesFreshKeyPerCall(t *testing.T) {
	t.Parallel()

	publicKey, _, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}

	plaintext := []byte("same bytes both times")
	first, err := EncryptAttachment(plaintext, *publicKey)
	if err != nil {
		t.Fatalf("first EncryptAttachment: %v", err)
	}
	second, err := EncryptAttachment(plaintext, *publicKey)
	if err != nil {
		t.Fatalf("second EncryptAttachment: %v", err)
	}

	if bytes.Equal(first.Ciphertext, second.Ciphertext) {
		t.Fatal("expected distinct ciphertext per call (fresh key/nonce)")
	}
	if first.SealedKeyB64 == second.SealedKeyB64 { //gitleaks:allow -- comparing two test outputs, not a secret
		t.Fatal("expected distinct sealed keys per call")
	}
}
