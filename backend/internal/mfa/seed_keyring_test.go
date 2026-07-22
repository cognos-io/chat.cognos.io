package mfa

import (
	"errors"
	"testing"
)

func TestSeedKeyringRoundTripPrimary(t *testing.T) {
	t.Parallel()

	keyring, err := NewSeedKeyring(newTestKeyB64(t))
	if err != nil {
		t.Fatal(err)
	}

	seed := []byte("JBSWY3DPEHPK3PXP")
	ct, nonce, err := keyring.Seal(seed)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	result, err := keyring.OpenAndReseal(ct, nonce, keyring.KeyID())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if result.NeedsReseal {
		t.Fatal("primary-encrypted seed must not need reseal")
	}
	if string(result.Seed) != string(seed) {
		t.Fatalf("round-trip mismatch: want %q got %q", seed, result.Seed)
	}
}

func TestSeedKeyringOpenWithPreviousKey(t *testing.T) {
	t.Parallel()

	previousB64 := newTestKeyB64(t)
	primaryB64 := newTestKeyB64(t)

	previous, err := NewSeedCipher(previousB64)
	if err != nil {
		t.Fatal(err)
	}

	seed := []byte("previous-key-seed")
	ct, nonce, err := previous.Seal(seed)
	if err != nil {
		t.Fatal(err)
	}

	keyring, err := NewSeedKeyring(primaryB64, previousB64)
	if err != nil {
		t.Fatal(err)
	}

	result, err := keyring.OpenAndReseal(ct, nonce, previous.KeyID())
	if err != nil {
		t.Fatalf("open with previous key: %v", err)
	}
	if string(result.Seed) != string(seed) {
		t.Fatalf("seed mismatch: want %q got %q", seed, result.Seed)
	}
	if !result.NeedsReseal {
		t.Fatal("seed opened with previous key must need reseal")
	}
	if result.KeyID != keyring.KeyID() {
		t.Fatalf("resealed key id = %q, want primary %q", result.KeyID, keyring.KeyID())
	}
}

func TestSeedKeyringResealToPrimary(t *testing.T) {
	t.Parallel()

	previousB64 := newTestKeyB64(t)
	primaryB64 := newTestKeyB64(t)

	previous, err := NewSeedCipher(previousB64)
	if err != nil {
		t.Fatal(err)
	}
	primary, err := NewSeedCipher(primaryB64)
	if err != nil {
		t.Fatal(err)
	}

	seed := []byte("lazy-rotation-seed")
	ct, nonce, err := previous.Seal(seed)
	if err != nil {
		t.Fatal(err)
	}

	keyring, err := NewSeedKeyring(primaryB64, previousB64)
	if err != nil {
		t.Fatal(err)
	}

	result, err := keyring.OpenAndReseal(ct, nonce, previous.KeyID())
	if err != nil {
		t.Fatal(err)
	}
	if !result.NeedsReseal {
		t.Fatal("expected reseal")
	}

	// Re-open the re-sealed payload with the primary only — no previous needed.
	primaryOnly, err := NewSeedKeyring(primaryB64)
	if err != nil {
		t.Fatal(err)
	}
	got, _, err := primaryOnly.open(result.Ciphertext, result.Nonce, result.KeyID)
	if err != nil {
		t.Fatalf("open resealed: %v", err)
	}
	if string(got) != string(seed) {
		t.Fatalf("resealed seed mismatch: want %q got %q", seed, got)
	}
	if result.KeyID != primary.KeyID() {
		t.Fatal("resealed row must carry primary key id")
	}
}

func TestSeedKeyringRejectsWrongKey(t *testing.T) {
	t.Parallel()

	keyring, err := NewSeedKeyring(newTestKeyB64(t))
	if err != nil {
		t.Fatal(err)
	}

	other, err := NewSeedCipher(newTestKeyB64(t))
	if err != nil {
		t.Fatal(err)
	}

	ct, nonce, err := other.Seal([]byte("secret"))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := keyring.OpenAndReseal(ct, nonce, other.KeyID()); err == nil {
		t.Fatal("opening with an unknown key must fail")
	}
}

func TestNewSeedKeyringRequiresPrimary(t *testing.T) {
	t.Parallel()

	if _, err := NewSeedKeyring(""); !errors.Is(err, ErrSeedCipherUnavailable) {
		t.Fatalf("empty primary: want %v, got %v", ErrSeedCipherUnavailable, err)
	}
}

func TestParseTOTPEncryptionKeysList(t *testing.T) {
	t.Parallel()

	got := ParseTOTPEncryptionKeysList(" a , ,b, c ")
	want := []string{"a", "b", "c"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("index %d: got %q want %q", i, got[i], want[i])
		}
	}
}
