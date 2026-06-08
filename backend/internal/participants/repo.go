// Package participants exposes the read/write surface for the conversation
// participants collection. It is the single source of truth for "is this
// user allowed to read this conversation" — handlers should consult IsActive
// instead of doing their own `creator == userID` check, so future sharing
// (multiple participants per conversation) lights up without a handler
// rewrite.
package participants

import (
	"errors"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Role mirrors the select values defined on the participants collection.
// Keep these strings in sync with the migration's enum.
type Role string

const (
	RoleAdmin  Role = "Admin"
	RoleEditor Role = "Editor"
	RoleViewer Role = "Viewer"
)

// CollectionName is the participants PocketBase collection name. Kept as a
// package constant so handlers and tests cannot accidentally diverge from
// the migration.
const CollectionName = "participants"

// ErrAlreadyParticipant is returned when AddParticipant is called for a row
// that already exists and is active. Callers can treat it as a soft no-op.
var ErrAlreadyParticipant = errors.New("participants: user is already a participant")

// Repo is the read/write surface for participant membership.
type Repo interface {
	// IsActive reports whether the given user currently has access to the
	// conversation. A row with a non-empty removed_at counts as revoked.
	IsActive(conversationID, userID string) (bool, error)

	// Add inserts a new active participant row. Returns ErrAlreadyParticipant
	// if an active row already exists.
	Add(conversationID, userID string, role Role) error
}

// PocketBaseRepo is the production implementation backed by the PocketBase app.
type PocketBaseRepo struct {
	app core.App
}

// NewPocketBaseRepo wires a Repo against the running PocketBase app.
func NewPocketBaseRepo(app core.App) *PocketBaseRepo {
	return &PocketBaseRepo{app: app}
}

// IsActive returns true when the user has a participant row for the
// conversation that has not been revoked (removed_at is empty).
func (r *PocketBaseRepo) IsActive(conversationID, userID string) (bool, error) {
	if conversationID == "" || userID == "" {
		return false, nil
	}

	record, err := r.app.FindFirstRecordByFilter(
		CollectionName,
		"conversation = {:conversation} && user = {:user} && removed_at = ''",
		dbx.Params{"conversation": conversationID, "user": userID},
	)
	if err != nil {
		// PocketBase returns a not-found error when no row matches. The
		// caller wants a boolean, not an error, so we treat absence as a
		// "not a participant" reply rather than propagating.
		return false, nil
	}
	return record != nil, nil
}

// Add inserts an active participant row for the conversation/user pair.
// If a non-revoked row already exists, returns ErrAlreadyParticipant.
func (r *PocketBaseRepo) Add(conversationID, userID string, role Role) error {
	if conversationID == "" {
		return errors.New("participants: conversationID is required")
	}
	if userID == "" {
		return errors.New("participants: userID is required")
	}
	if role == "" {
		return errors.New("participants: role is required")
	}

	existing, err := r.app.FindFirstRecordByFilter(
		CollectionName,
		"conversation = {:conversation} && user = {:user} && removed_at = ''",
		dbx.Params{"conversation": conversationID, "user": userID},
	)
	if err == nil && existing != nil {
		return ErrAlreadyParticipant
	}

	collection, err := r.app.FindCollectionByNameOrId(CollectionName)
	if err != nil {
		return err
	}

	record := core.NewRecord(collection)
	record.Set("conversation", conversationID)
	record.Set("user", userID)
	record.Set("role", string(role))
	record.Set("added_at", time.Now().UTC())
	return r.app.Save(record)
}
