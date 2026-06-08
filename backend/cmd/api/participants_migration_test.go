package main

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestParticipantsCollectionExistsAfterMigrations(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	collection, err := app.FindCollectionByNameOrId("participants")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(participants) error = %v", err)
	}

	// The collection ID is pinned because pre-existing PocketBase access
	// rules on conversations / messages / conversation_(public|secret)_keys
	// reference @collection.participants by name — restoring the historical
	// ID keeps those rule strings resolving against the same target.
	if collection.Id != "52et2jthsxn7mjr" {
		t.Errorf("participants.Id = %q, want %q", collection.Id, "52et2jthsxn7mjr")
	}

	for _, name := range []string{"conversation", "user", "role", "added_at", "removed_at"} {
		if collection.Fields.GetByName(name) == nil {
			t.Errorf("participants is missing the %q field", name)
		}
	}
}

func TestParticipantsUniqueIndexRejectsDuplicateMembership(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	conversationID := "convparts000001"
	seedOwnedConversation(t, app, conversationID, "test1@example.com")

	userRecord, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail = %v", err)
	}

	collection, err := app.FindCollectionByNameOrId("participants")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(participants) error = %v", err)
	}

	first := core.NewRecord(collection)
	first.Set("conversation", conversationID)
	first.Set("user", userRecord.Id)
	first.Set("role", "Admin")
	if err := app.Save(first); err != nil {
		t.Fatalf("Save(first participant) error = %v", err)
	}

	second := core.NewRecord(collection)
	second.Set("conversation", conversationID)
	second.Set("user", userRecord.Id)
	second.Set("role", "Editor")
	if err := app.Save(second); err == nil {
		t.Fatalf("Save(duplicate participant) error = nil, want unique-index violation")
	}
}

func TestParticipantsCascadeOnConversationDelete(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	conversationID := "convparts000002"
	seedOwnedConversation(t, app, conversationID, "test1@example.com")

	userRecord, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail = %v", err)
	}

	collection, err := app.FindCollectionByNameOrId("participants")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(participants) error = %v", err)
	}

	participant := core.NewRecord(collection)
	participant.Set("conversation", conversationID)
	participant.Set("user", userRecord.Id)
	participant.Set("role", "Admin")
	if err := app.Save(participant); err != nil {
		t.Fatalf("Save(participant) error = %v", err)
	}

	conversation, err := app.FindRecordById("conversations", conversationID)
	if err != nil {
		t.Fatalf("FindRecordById(conversations) error = %v", err)
	}
	if err := app.Delete(conversation); err != nil {
		t.Fatalf("Delete(conversation) error = %v", err)
	}

	// cascadeDelete on the conversation relation must take the participant row
	// with the conversation — otherwise stale participant rows would block
	// fresh inserts (the unique index would already be occupied).
	if _, err := app.FindRecordById("participants", participant.Id); err == nil {
		t.Fatalf("participant survived conversation deletion: want cascade")
	}
}
