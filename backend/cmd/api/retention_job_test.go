package main

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/retention"
)

// setConversationRetention sets the plaintext retention override on a seeded
// conversation without going through the API.
func setConversationRetention(t testing.TB, app *tests.TestApp, conversationID string, days int) {
	t.Helper()
	record, err := app.FindRecordById("conversations", conversationID)
	if err != nil {
		t.Fatalf("FindRecordById(conversations, %q) error = %v", conversationID, err)
	}
	record.Set("retention_days", days)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(conversation %q retention_days) error = %v", conversationID, err)
	}
}

// setAccountRetentionDefault sets the plaintext account default on a seeded user.
func setAccountRetentionDefault(t testing.TB, app *tests.TestApp, email string, days int) {
	t.Helper()
	record, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", email, err)
	}
	record.Set("default_retention_days", days)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(user %q default_retention_days) error = %v", email, err)
	}
}

func TestRetentionRepoFindExpiredConversationIDs(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	const old = "2020-01-01 00:00:00.000Z"

	// test1 opts into a 30-day account default; test2 stays at never (0).
	setAccountRetentionDefault(t, app, "test1@example.com", 30)
	setAccountRetentionDefault(t, app, "test2@example.com", 0)

	// A: explicit 7-day override, stale → expired.
	seedOwnedConversation(t, app, "retexpire000001", "test1@example.com")
	setConversationRetention(t, app, "retexpire000001", 7)
	setConversationLastActivityAt(t, app, "retexpire000001", old)

	// B: inherit, creator default 30d, stale → expired.
	seedOwnedConversation(t, app, "retexpire000002", "test1@example.com")
	setConversationRetention(t, app, "retexpire000002", retention.ConversationInherit)
	setConversationLastActivityAt(t, app, "retexpire000002", old)

	// C: explicit never (-1), stale → kept.
	seedOwnedConversation(t, app, "retkeepx0000001", "test1@example.com")
	setConversationRetention(t, app, "retkeepx0000001", retention.ConversationNever)
	setConversationLastActivityAt(t, app, "retkeepx0000001", old)

	// D: inherit, creator default never (test2), stale → kept.
	seedOwnedConversation(t, app, "retkeepx0000002", "test2@example.com")
	setConversationRetention(t, app, "retkeepx0000002", retention.ConversationInherit)
	setConversationLastActivityAt(t, app, "retkeepx0000002", old)

	// E: explicit 7-day override but recent activity → kept.
	seedOwnedConversation(t, app, "retkeepx0000003", "test1@example.com")
	setConversationRetention(t, app, "retkeepx0000003", 7)
	setConversationLastActivityAt(t, app, "retkeepx0000003",
		time.Now().UTC().Format("2006-01-02 15:04:05.000Z"))

	repo := retention.NewPocketBaseRepo(app)
	ids, err := repo.FindExpiredConversationIDs(time.Now().UTC())
	if err != nil {
		t.Fatalf("FindExpiredConversationIDs error = %v", err)
	}

	got := map[string]bool{}
	for _, id := range ids {
		got[id] = true
	}

	wantExpired := []string{"retexpire000001", "retexpire000002"}
	for _, id := range wantExpired {
		if !got[id] {
			t.Errorf("expected %q to be expired, got set %v", id, ids)
		}
	}
	for _, id := range []string{"retkeepx0000001", "retkeepx0000002", "retkeepx0000003"} {
		if got[id] {
			t.Errorf("expected %q to be kept, but it was flagged expired", id)
		}
	}
}

func TestRetentionRepoDeleteConversationsCascades(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	conversationID := "retdeletex00001"
	messageID := "retdelmsgx00001"

	seedOwnedConversation(t, app, conversationID, "test1@example.com")
	seedMessage(t, app, messageID, conversationID, false)

	repo := retention.NewPocketBaseRepo(app)
	deleted, err := repo.DeleteConversations([]string{conversationID})
	if err != nil {
		t.Fatalf("DeleteConversations error = %v", err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}

	if _, err := app.FindRecordById("conversations", conversationID); err == nil {
		t.Fatalf("conversation %q still exists after delete", conversationID)
	}
	if _, err := app.FindRecordById("messages", messageID); err == nil {
		t.Fatalf("message %q was not cascade-deleted with its conversation", messageID)
	}
}
