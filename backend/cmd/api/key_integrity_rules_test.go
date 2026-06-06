package main

import (
	"strings"
	"testing"
)

func TestKeyIntegrityFieldsExist(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	userKeyPairs, err := app.FindCollectionByNameOrId("user_key_pairs")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(user_key_pairs) error = %v", err)
	}
	if userKeyPairs.Fields.GetByName("record_mac") == nil {
		t.Fatal("user_key_pairs missing record_mac field")
	}
	if userKeyPairs.CreateRule == nil {
		t.Fatal("user_key_pairs create rule is nil")
	}
	for _, want := range []string{"password_salt:isset = true", "unlock_scheme = \"password_account_key_v1\"", "record_mac:isset = true"} {
		if !strings.Contains(*userKeyPairs.CreateRule, want) {
			t.Fatalf("user_key_pairs create rule = %q, want substring %q", *userKeyPairs.CreateRule, want)
		}
	}
	if userKeyPairs.UpdateRule == nil {
		t.Fatal("user_key_pairs update rule is nil")
	}
	for _, want := range []string{"password_salt:isset = false", "unlock_scheme:isset = false", "record_mac:isset = true"} {
		if !strings.Contains(*userKeyPairs.UpdateRule, want) {
			t.Fatalf("user_key_pairs update rule = %q, want substring %q", *userKeyPairs.UpdateRule, want)
		}
	}

	conversationPublicKeys, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) error = %v", err)
	}
	if conversationPublicKeys.Fields.GetByName("public_key_signature") == nil {
		t.Fatal("conversation_public_keys missing public_key_signature field")
	}
	if conversationPublicKeys.CreateRule == nil {
		t.Fatal("conversation_public_keys create rule is nil")
	}
	for _, want := range []string{"public_key_signature:isset = true"} {
		if !strings.Contains(*conversationPublicKeys.CreateRule, want) {
			t.Fatalf("conversation_public_keys create rule = %q, want substring %q", *conversationPublicKeys.CreateRule, want)
		}
	}
	if conversationPublicKeys.UpdateRule == nil {
		t.Fatal("conversation_public_keys update rule is nil")
	}
	if !strings.Contains(strings.Join(conversationPublicKeys.Indexes, "\n"), "idx_conversation_public_keys_conversation_unique") {
		t.Fatalf("conversation_public_keys indexes = %v, want unique conversation index", conversationPublicKeys.Indexes)
	}
}
