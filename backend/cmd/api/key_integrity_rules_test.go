package main

import "testing"

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
	if userKeyPairs.UpdateRule == nil {
		t.Fatal("user_key_pairs update rule is nil")
	}

	conversationPublicKeys, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) error = %v", err)
	}
	if conversationPublicKeys.Fields.GetByName("public_key_signature") == nil {
		t.Fatal("conversation_public_keys missing public_key_signature field")
	}
	if conversationPublicKeys.UpdateRule == nil {
		t.Fatal("conversation_public_keys update rule is nil")
	}
}
