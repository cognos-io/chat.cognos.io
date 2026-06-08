package main

import (
	"errors"
	"testing"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/participants"
	"github.com/pocketbase/pocketbase/tests"
)

func TestParticipantsRepoIsActiveFalseForNonParticipant(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	conversationID := "convrepoacc0001"
	seedOwnedConversation(t, app, conversationID, "test1@example.com")

	other, err := app.FindAuthRecordByEmail("users", "test2@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail = %v", err)
	}

	repo := participants.NewPocketBaseRepo(app)
	active, err := repo.IsActive(conversationID, other.Id)
	if err != nil {
		t.Fatalf("IsActive error = %v", err)
	}
	if active {
		t.Fatalf("IsActive(non-participant) = true, want false")
	}
}

func TestParticipantsRepoIsActiveTrueForAddedParticipant(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	conversationID := "convrepoacc0002"
	seedOwnedConversation(t, app, conversationID, "test1@example.com")

	user, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail = %v", err)
	}

	repo := participants.NewPocketBaseRepo(app)
	if err := repo.Add(conversationID, user.Id, participants.RoleAdmin); err != nil {
		t.Fatalf("Add error = %v", err)
	}

	active, err := repo.IsActive(conversationID, user.Id)
	if err != nil {
		t.Fatalf("IsActive error = %v", err)
	}
	if !active {
		t.Fatalf("IsActive(active participant) = false, want true")
	}
}

func TestParticipantsRepoIsActiveFalseAfterRevoke(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	conversationID := "convrepoacc0003"
	seedOwnedConversation(t, app, conversationID, "test1@example.com")

	user, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail = %v", err)
	}

	repo := participants.NewPocketBaseRepo(app)
	if err := repo.Add(conversationID, user.Id, participants.RoleAdmin); err != nil {
		t.Fatalf("Add error = %v", err)
	}

	// Soft-revoke by stamping removed_at on the row. IsActive must treat any
	// non-empty removed_at as "no longer a participant" so we can keep the
	// audit row around without granting access.
	revokeParticipant(t, app, conversationID, user.Id)

	active, err := repo.IsActive(conversationID, user.Id)
	if err != nil {
		t.Fatalf("IsActive error = %v", err)
	}
	if active {
		t.Fatalf("IsActive(revoked participant) = true, want false")
	}
}

func TestParticipantsRepoAddRejectsDuplicate(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	conversationID := "convrepoacc0004"
	seedOwnedConversation(t, app, conversationID, "test1@example.com")

	user, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail = %v", err)
	}

	repo := participants.NewPocketBaseRepo(app)
	if err := repo.Add(conversationID, user.Id, participants.RoleAdmin); err != nil {
		t.Fatalf("Add(first) error = %v", err)
	}

	err = repo.Add(conversationID, user.Id, participants.RoleEditor)
	if !errors.Is(err, participants.ErrAlreadyParticipant) {
		t.Fatalf("Add(duplicate) = %v, want ErrAlreadyParticipant", err)
	}
}

func TestParticipantsRepoIsActiveRejectsEmptyArgs(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	repo := participants.NewPocketBaseRepo(app)

	for _, tc := range []struct{ conversationID, userID string }{
		{"", "u1"},
		{"c1", ""},
		{"", ""},
	} {
		active, err := repo.IsActive(tc.conversationID, tc.userID)
		if err != nil {
			t.Errorf("IsActive(%q,%q) err = %v, want nil", tc.conversationID, tc.userID, err)
		}
		if active {
			t.Errorf("IsActive(%q,%q) = true, want false", tc.conversationID, tc.userID)
		}
	}
}

func revokeParticipant(t testing.TB, app *tests.TestApp, conversationID, userID string) {
	t.Helper()

	record, err := app.FindFirstRecordByFilter(
		participants.CollectionName,
		"conversation = {:c} && user = {:u}",
		map[string]any{"c": conversationID, "u": userID},
	)
	if err != nil {
		t.Fatalf("FindFirstRecordByFilter(participants) error = %v", err)
	}
	if record == nil {
		t.Fatalf("FindFirstRecordByFilter(participants) = nil")
	}
	record.Set("removed_at", time.Now().UTC())
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(revoke) error = %v", err)
	}
}
