package main

import (
	"bytes"
	"encoding/base64"
	"errors"
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

func TestUserPublicKeyHappyPath(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	repo := auth.NewPocketBaseKeyPairRepo(app)

	got, err := repo.UserPublicKey("uvi8zmr78j9y5hz")
	if err != nil {
		t.Fatalf("UserPublicKey() error = %v, want nil", err)
	}

	want, err := base64.StdEncoding.DecodeString("FaTq77hDYWu9pNLMwBlQ4Ks54BAfwz1Y7/nmyZTLkTE=")
	if err != nil {
		t.Fatalf("decode seed public key: %v", err)
	}
	if !bytes.Equal(got[:], want) {
		t.Fatalf("UserPublicKey() = %x, want %x", got, want)
	}
}

func TestUserPublicKeyMissingRecordReturnsErrNoKeyPair(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	repo := auth.NewPocketBaseKeyPairRepo(app)

	_, err := repo.UserPublicKey("nonexistent-id")
	if !errors.Is(err, auth.ErrNoKeyPair) {
		t.Fatalf("UserPublicKey() error = %v, want %v", err, auth.ErrNoKeyPair)
	}
}

func TestConversationPublicKeyHappyPath(t *testing.T) {
	t.Parallel()

	const conversationID = "convpkhappy0001"

	app := setupTestApp(t)
	repo := auth.NewPocketBaseKeyPairRepo(app)
	seedOwnedConversation(t, app, conversationID, "test1@example.com")

	wantBytes := bytes.Repeat([]byte{7}, 32)
	wantB64 := base64.StdEncoding.EncodeToString(wantBytes)

	conversationKeyCollection, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) error = %v", err)
	}
	record := core.NewRecord(conversationKeyCollection)
	record.Set("conversation", conversationID)
	record.Set("public_key", wantB64)
	record.Set("public_key_signature", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32)))
	record.Set("key_version", 1)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(conversation_public_keys) error = %v", err)
	}

	got, err := repo.ConversationPublicKey(conversationID)
	if err != nil {
		t.Fatalf("ConversationPublicKey() error = %v", err)
	}
	if !bytes.Equal(got[:], wantBytes) {
		t.Fatalf("ConversationPublicKey() = %x, want %x", got, wantBytes)
	}
}

func TestConversationPublicKeyMissingRecordReturnsErrNoKeyPair(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	repo := auth.NewPocketBaseKeyPairRepo(app)

	_, err := repo.ConversationPublicKey("conv-with-no-key")
	if !errors.Is(err, auth.ErrNoKeyPair) {
		t.Fatalf("ConversationPublicKey() error = %v, want %v", err, auth.ErrNoKeyPair)
	}
}

// TestConversationPublicKeyReturnsCurrentGeneration locks the contract behind
// fix 0681310: when more than one public_key row exists for a conversation
// (the rotation case where the prior generation stays in the DB for audit),
// the lookup must return the highest key_version, never the legacy row.
func TestConversationPublicKeyReturnsCurrentGeneration(t *testing.T) {
	t.Parallel()

	const conversationID = "convpkrotate001"

	app := setupTestApp(t)
	repo := auth.NewPocketBaseKeyPairRepo(app)
	seedOwnedConversation(t, app, conversationID, "test1@example.com")

	v1Bytes := bytes.Repeat([]byte{1}, 32)
	v2Bytes := bytes.Repeat([]byte{2}, 32)

	conversationKeyCollection, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) error = %v", err)
	}

	for _, gen := range []struct {
		version int
		key     []byte
	}{
		{1, v1Bytes},
		{2, v2Bytes},
	} {
		record := core.NewRecord(conversationKeyCollection)
		record.Set("conversation", conversationID)
		record.Set("public_key", base64.StdEncoding.EncodeToString(gen.key))
		record.Set("public_key_signature", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32)))
		record.Set("key_version", gen.version)
		if err := app.Save(record); err != nil {
			t.Fatalf("Save(conversation_public_keys v=%d) error = %v", gen.version, err)
		}
	}

	got, err := repo.ConversationPublicKey(conversationID)
	if err != nil {
		t.Fatalf("ConversationPublicKey() error = %v", err)
	}
	if !bytes.Equal(got[:], v2Bytes) {
		t.Fatalf("ConversationPublicKey() = %x, want v2 %x (not v1 %x)", got, v2Bytes, v1Bytes)
	}
}
