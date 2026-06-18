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
	for _, want := range []string{"password_salt:isset = true", "unlock_scheme = \"account_key_v2\"", "record_mac:isset = true"} {
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
	// The collection rules are now intentionally locked — production
	// writes go through /api/v1/conversations/{id}/public-key which
	// validates the body Go-side and persists via app.Save. The body
	// validation that used to live inside the create-rule string is
	// covered by the handler-level integration test
	// (TestConversationPublicKeysKeyVersionFieldExists et al.) plus the
	// e2e `conversation-keys-api.spec.ts` contract.
	if conversationPublicKeys.CreateRule != nil {
		t.Fatalf("conversation_public_keys create rule = %q, want nil (locked)", *conversationPublicKeys.CreateRule)
	}

	// The historical index was `(conversation)` alone — rotation
	// needed to insert a fresh public_key row per generation, so the
	// invariant tightened to `(conversation, key_version)` instead.
	// The narrower index still rejects accidental duplicates within a
	// single generation but allows the rotation flow to layer audit
	// rows for older generations.
	if !strings.Contains(strings.Join(conversationPublicKeys.Indexes, "\n"), "idx_conversation_public_keys_conversation_key_version_unique") {
		t.Fatalf("conversation_public_keys indexes = %v, want unique (conversation, key_version) index", conversationPublicKeys.Indexes)
	}
}
