package main

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/pocketbase/pocketbase/core"
)

func TestUserPublicKeyRejectsInvalidKeyLength(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	repo := auth.NewPocketBaseKeyPairRepo(app)

	userRecord, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, test1@example.com) error = %v", err)
	}

	keyPairRecord, err := app.FindFirstRecordByData("user_key_pairs", "user", userRecord.Id)
	if err != nil {
		t.Fatalf("FindFirstRecordByData(user_key_pairs) error = %v", err)
	}

	keyPairRecord.Set("public_key", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 31)))
	if err := app.Save(keyPairRecord); err != nil {
		t.Fatalf("Save(user_key_pairs) error = %v", err)
	}

	_, err = repo.UserPublicKey(userRecord.Id)
	if err == nil || !strings.Contains(err.Error(), "invalid user public key length: 31") {
		t.Fatalf("UserPublicKey() error = %v, want invalid key length error", err)
	}
}

func TestConversationPublicKeyRejectsInvalidKeyLength(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	repo := auth.NewPocketBaseKeyPairRepo(app)

	userRecord, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, test1@example.com) error = %v", err)
	}

	conversationCollection, err := app.FindCollectionByNameOrId("conversations")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversations) error = %v", err)
	}
	conversationRecord := core.NewRecord(conversationCollection)
	conversationRecord.Id = "convkeylen00001"
	conversationRecord.Set("creator", userRecord.Id)
	conversationRecord.Set("data", base64.StdEncoding.EncodeToString([]byte(`{"title":"Test"}`)))
	if err := app.Save(conversationRecord); err != nil {
		t.Fatalf("Save(conversations) error = %v", err)
	}

	conversationKeyCollection, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) error = %v", err)
	}
	conversationKeyRecord := core.NewRecord(conversationKeyCollection)
	conversationKeyRecord.Set("conversation", conversationRecord.Id)
	conversationKeyRecord.Set("public_key", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 31)))
	conversationKeyRecord.Set("public_key_signature", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)))
	if err := app.Save(conversationKeyRecord); err != nil {
		t.Fatalf("Save(conversation_public_keys) error = %v", err)
	}

	_, err = repo.ConversationPublicKey(conversationRecord.Id)
	if err == nil || !strings.Contains(err.Error(), "invalid conversation public key length: 31") {
		t.Fatalf("ConversationPublicKey() error = %v, want invalid key length error", err)
	}
}
