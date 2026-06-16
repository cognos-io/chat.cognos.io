package chat

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"golang.org/x/crypto/nacl/box"
)

func TestEncryptMessageDataRoundTrip(t *testing.T) {
	t.Parallel()

	recipientPub, recipientPriv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("box.GenerateKey() err = %v, want nil", err)
	}

	message := MessageRecordData{
		Version:         "1",
		Content:         "hello world",
		ConversationID:  "conv-123",
		ParentMessageID: "parent-456",
		CreatedAt:       "2026-06-09T22:36:04Z",
		OwnerID:         "user-789",
		PersonaID:       "cognos:simple-assistant",
		ModelID:         "llama-3-3-infomaniak",
	}

	encoded, err := EncryptMessageData(message, *recipientPub)
	if err != nil {
		t.Fatalf("EncryptMessageData() err = %v, want nil", err)
	}
	if encoded == "" {
		t.Fatal("EncryptMessageData() returned empty ciphertext")
	}

	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("base64 decode of ciphertext failed: %v", err)
	}

	plaintext, ok := box.OpenAnonymous(nil, ciphertext, recipientPub, recipientPriv)
	if !ok {
		t.Fatal("box.OpenAnonymous(...) ok = false, want true")
	}

	var got MessageRecordData
	if err := json.Unmarshal(plaintext, &got); err != nil {
		t.Fatalf("json.Unmarshal(plaintext) err = %v, want nil", err)
	}

	if got != message {
		t.Errorf("decrypted MessageRecordData = %+v, want %+v", got, message)
	}
}

func TestEncryptMessageDataNonDeterministicCiphertext(t *testing.T) {
	t.Parallel()

	recipientPub, _, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("box.GenerateKey() err = %v, want nil", err)
	}

	message := MessageRecordData{Content: "repeat"}

	a, err := EncryptMessageData(message, *recipientPub)
	if err != nil {
		t.Fatalf("first EncryptMessageData() err = %v, want nil", err)
	}
	b, err := EncryptMessageData(message, *recipientPub)
	if err != nil {
		t.Fatalf("second EncryptMessageData() err = %v, want nil", err)
	}

	if a == b {
		t.Error("EncryptMessageData() produced identical ciphertext for identical input")
	}
}

func TestEncryptMessageDataOmitsEmptyFields(t *testing.T) {
	t.Parallel()

	recipientPub, recipientPriv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("box.GenerateKey() err = %v, want nil", err)
	}

	message := MessageRecordData{Content: "minimal"}

	encoded, err := EncryptMessageData(message, *recipientPub)
	if err != nil {
		t.Fatalf("EncryptMessageData() err = %v, want nil", err)
	}

	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("base64 decode of ciphertext failed: %v", err)
	}
	plaintext, ok := box.OpenAnonymous(nil, ciphertext, recipientPub, recipientPriv)
	if !ok {
		t.Fatal("box.OpenAnonymous(...) ok = false, want true")
	}

	for _, field := range []string{"version", "conversation_id", "parent_message_id", "created_at", "owner_id", "persona_id", "model_id"} {
		if strings.Contains(string(plaintext), `"`+field+`"`) {
			t.Errorf("encrypted plaintext unexpectedly contained omitempty field %q: %s", field, plaintext)
		}
	}
}

func TestEncryptMessageDataCannotBeOpenedByWrongRecipient(t *testing.T) {
	t.Parallel()

	recipientPub, _, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("recipient box.GenerateKey() err = %v, want nil", err)
	}
	wrongPub, wrongPriv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("wrong box.GenerateKey() err = %v, want nil", err)
	}

	encoded, err := EncryptMessageData(MessageRecordData{Content: "secret"}, *recipientPub)
	if err != nil {
		t.Fatalf("EncryptMessageData() err = %v, want nil", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("base64 decode of ciphertext failed: %v", err)
	}

	if _, ok := box.OpenAnonymous(nil, ciphertext, wrongPub, wrongPriv); ok {
		t.Error("box.OpenAnonymous(...) with wrong recipient ok = true, want false")
	}
}
