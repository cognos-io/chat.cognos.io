package crypto

import (
	"bytes"
	"crypto/rand"
	"testing"

	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/secretbox"
)

func TestNewNonceReturns24RandomBytes(t *testing.T) {
	t.Parallel()

	a, err := NewNonce()
	if err != nil {
		t.Fatalf("NewNonce() err = %v, want nil", err)
	}
	if len(a) != 24 {
		t.Fatalf("len(NewNonce()) = %d, want 24", len(a))
	}

	var zero [24]byte
	if a == zero {
		t.Error("NewNonce() returned an all-zero nonce")
	}

	b, err := NewNonce()
	if err != nil {
		t.Fatalf("second NewNonce() err = %v, want nil", err)
	}
	if a == b {
		t.Error("two NewNonce() calls returned the same nonce")
	}
}

func TestNewSymmetricKeyReturns32RandomBytes(t *testing.T) {
	t.Parallel()

	a, err := NewSymmetricKey()
	if err != nil {
		t.Fatalf("NewSymmetricKey() err = %v, want nil", err)
	}
	if len(a) != 32 {
		t.Fatalf("len(NewSymmetricKey()) = %d, want 32", len(a))
	}

	var zero [32]byte
	if a == zero {
		t.Error("NewSymmetricKey() returned an all-zero key")
	}

	b, err := NewSymmetricKey()
	if err != nil {
		t.Fatalf("second NewSymmetricKey() err = %v, want nil", err)
	}
	if a == b {
		t.Error("two NewSymmetricKey() calls returned the same key")
	}
}

func TestAsymmetricEncryptRoundTrip(t *testing.T) {
	t.Parallel()

	recipientPub, recipientPriv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("box.GenerateKey() err = %v, want nil", err)
	}

	message := []byte("the quick brown fox jumps over the lazy dog")

	ciphertext, err := AsymmetricEncrypt(*recipientPub, message)
	if err != nil {
		t.Fatalf("AsymmetricEncrypt() err = %v, want nil", err)
	}
	if bytes.Equal(ciphertext, message) {
		t.Fatal("AsymmetricEncrypt() ciphertext equals plaintext")
	}

	plaintext, ok := box.OpenAnonymous(nil, ciphertext, recipientPub, recipientPriv)
	if !ok {
		t.Fatal("box.OpenAnonymous(...) ok = false, want true")
	}
	if !bytes.Equal(plaintext, message) {
		t.Errorf("decrypted plaintext = %q, want %q", plaintext, message)
	}
}

func TestAsymmetricEncryptIsNonDeterministic(t *testing.T) {
	t.Parallel()

	recipientPub, _, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("box.GenerateKey() err = %v, want nil", err)
	}

	message := []byte("repeat me")

	a, err := AsymmetricEncrypt(*recipientPub, message)
	if err != nil {
		t.Fatalf("first AsymmetricEncrypt() err = %v, want nil", err)
	}
	b, err := AsymmetricEncrypt(*recipientPub, message)
	if err != nil {
		t.Fatalf("second AsymmetricEncrypt() err = %v, want nil", err)
	}

	if bytes.Equal(a, b) {
		t.Error("AsymmetricEncrypt() produced identical ciphertext for the same plaintext; ephemeral key did not vary")
	}
}

func TestAsymmetricEncryptCannotBeOpenedByWrongRecipient(t *testing.T) {
	t.Parallel()

	recipientPub, _, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("recipient box.GenerateKey() err = %v, want nil", err)
	}
	wrongPub, wrongPriv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("wrong box.GenerateKey() err = %v, want nil", err)
	}

	ciphertext, err := AsymmetricEncrypt(*recipientPub, []byte("secret"))
	if err != nil {
		t.Fatalf("AsymmetricEncrypt() err = %v, want nil", err)
	}

	if _, ok := box.OpenAnonymous(nil, ciphertext, wrongPub, wrongPriv); ok {
		t.Error("box.OpenAnonymous(...) with wrong recipient ok = true, want false")
	}
}

func TestSymmetricEncryptRoundTrip(t *testing.T) {
	t.Parallel()

	message := []byte("symmetric round trip test payload")

	key, ciphertext, err := SymmetricEncrypt(message)
	if err != nil {
		t.Fatalf("SymmetricEncrypt() err = %v, want nil", err)
	}
	if len(ciphertext) < 24 {
		t.Fatalf("SymmetricEncrypt() ciphertext too short (len=%d) to contain a 24-byte nonce prefix", len(ciphertext))
	}
	var zero [32]byte
	if key == zero {
		t.Fatal("SymmetricEncrypt() returned an all-zero key")
	}

	var nonce [24]byte
	copy(nonce[:], ciphertext[:24])
	plaintext, ok := secretbox.Open(nil, ciphertext[24:], &nonce, &key)
	if !ok {
		t.Fatal("secretbox.Open(...) ok = false, want true")
	}
	if !bytes.Equal(plaintext, message) {
		t.Errorf("decrypted plaintext = %q, want %q", plaintext, message)
	}
}

func TestSymmetricEncryptIsNonDeterministic(t *testing.T) {
	t.Parallel()

	message := []byte("repeat me")

	keyA, ciphertextA, err := SymmetricEncrypt(message)
	if err != nil {
		t.Fatalf("first SymmetricEncrypt() err = %v, want nil", err)
	}
	keyB, ciphertextB, err := SymmetricEncrypt(message)
	if err != nil {
		t.Fatalf("second SymmetricEncrypt() err = %v, want nil", err)
	}

	if keyA == keyB {
		t.Error("SymmetricEncrypt() produced the same symmetric key across calls")
	}
	if bytes.Equal(ciphertextA, ciphertextB) {
		t.Error("SymmetricEncrypt() produced identical ciphertext across calls")
	}
}

func TestSymmetricEncryptTamperedCiphertextFailsToOpen(t *testing.T) {
	t.Parallel()

	key, ciphertext, err := SymmetricEncrypt([]byte("tamper detection payload"))
	if err != nil {
		t.Fatalf("SymmetricEncrypt() err = %v, want nil", err)
	}

	tampered := append([]byte(nil), ciphertext...)
	tampered[len(tampered)-1] ^= 0x01

	var nonce [24]byte
	copy(nonce[:], tampered[:24])
	if _, ok := secretbox.Open(nil, tampered[24:], &nonce, &key); ok {
		t.Error("secretbox.Open(...) on tampered ciphertext ok = true, want false")
	}
}
