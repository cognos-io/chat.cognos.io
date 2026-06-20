// Package projectparticipants exposes the read/write surface for the
// project_participants collection. It is the single source of truth for "is
// this user allowed to read this project" — handlers consult IsActive instead
// of doing their own `creator == userID` check, so project sharing (multiple
// participants per project) works without a handler rewrite.
//
// It mirrors the conversation-scoped participants package; the two are kept
// separate rather than generalised so the security-critical access filter for
// each resource stays explicit and independently testable.
package projectparticipants

import (
	"errors"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Role mirrors the select values defined on the project_participants
// collection. Keep these strings in sync with the migration's enum.
type Role string

const (
	RoleAdmin  Role = "Admin"
	RoleEditor Role = "Editor"
	RoleViewer Role = "Viewer"
)

// CollectionName is the project_participants PocketBase collection name. Kept
// as a package constant so handlers and tests cannot accidentally diverge from
// the migration.
const CollectionName = "project_participants"

// ErrAlreadyParticipant is returned when Add is called for a row that already
// exists and is active. Callers can treat it as a soft no-op.
var ErrAlreadyParticipant = errors.New("projectparticipants: user is already a participant")

// ErrParticipantNotFound is returned when a revoke targets a user with no
// active participant row on the project.
var ErrParticipantNotFound = errors.New("projectparticipants: user is not an active participant")

// Membership is the read-shape of a single participant row.
type Membership struct {
	ID        string
	ProjectID string
	UserID    string
	Role      Role
	AddedAt   string
}

// Repo is the read/write surface for project membership.
type Repo interface {
	// IsActive reports whether the given user currently has access to the
	// project. A row with a non-empty removed_at counts as revoked.
	IsActive(projectID, userID string) (bool, error)

	// ActiveRole returns the role the user currently holds on the project.
	// The second return is false when the user is not an active participant.
	ActiveRole(projectID, userID string) (Role, bool, error)

	// Add inserts a new active participant row. Returns ErrAlreadyParticipant
	// if an active row already exists.
	Add(projectID, userID string, role Role) error

	// Revoke stamps removed_at on the active participant row for the given
	// user. Returns ErrParticipantNotFound when no active row exists. The
	// historical row is kept as audit data.
	Revoke(projectID, userID string) error

	// ListActive returns all currently-active participants of a project
	// (removed_at is empty), ordered by added_at ascending so the creator
	// comes first.
	ListActive(projectID string) ([]Membership, error)
}

// PocketBaseRepo is the production implementation backed by the PocketBase app.
type PocketBaseRepo struct {
	app core.App
}

// NewPocketBaseRepo wires a Repo against the running PocketBase app.
func NewPocketBaseRepo(app core.App) *PocketBaseRepo {
	return &PocketBaseRepo{app: app}
}

// ActiveRole returns the user's current role on the project. The second return
// is false when no active row exists; the Role is empty in that case and
// callers must treat the user as having no access.
func (r *PocketBaseRepo) ActiveRole(projectID, userID string) (Role, bool, error) {
	if projectID == "" || userID == "" {
		return "", false, nil
	}

	record, err := r.app.FindFirstRecordByFilter(
		CollectionName,
		"project = {:project} && user = {:user} && removed_at = ''",
		dbx.Params{"project": projectID, "user": userID},
	)
	if err != nil || record == nil {
		return "", false, nil
	}
	return Role(record.GetString("role")), true, nil
}

// IsActive returns true when the user has a participant row for the project
// that has not been revoked (removed_at is empty).
func (r *PocketBaseRepo) IsActive(projectID, userID string) (bool, error) {
	if projectID == "" || userID == "" {
		return false, nil
	}

	record, err := r.app.FindFirstRecordByFilter(
		CollectionName,
		"project = {:project} && user = {:user} && removed_at = ''",
		dbx.Params{"project": projectID, "user": userID},
	)
	if err != nil {
		// PocketBase returns a not-found error when no row matches. The
		// caller wants a boolean, so we treat absence as "not a participant"
		// rather than propagating.
		return false, nil
	}
	return record != nil, nil
}

// Add inserts an active participant row for the project/user pair. If a
// non-revoked row already exists, returns ErrAlreadyParticipant.
func (r *PocketBaseRepo) Add(projectID, userID string, role Role) error {
	if projectID == "" {
		return errors.New("projectparticipants: projectID is required")
	}
	if userID == "" {
		return errors.New("projectparticipants: userID is required")
	}
	if role == "" {
		return errors.New("projectparticipants: role is required")
	}

	existing, err := r.app.FindFirstRecordByFilter(
		CollectionName,
		"project = {:project} && user = {:user} && removed_at = ''",
		dbx.Params{"project": projectID, "user": userID},
	)
	if err == nil && existing != nil {
		return ErrAlreadyParticipant
	}

	collection, err := r.app.FindCollectionByNameOrId(CollectionName)
	if err != nil {
		return err
	}

	record := core.NewRecord(collection)
	record.Set("project", projectID)
	record.Set("user", userID)
	record.Set("role", string(role))
	record.Set("added_at", time.Now().UTC())
	return r.app.Save(record)
}

// Revoke stamps removed_at on the matching active row. A missing active row
// returns ErrParticipantNotFound so callers can decide how to surface it.
func (r *PocketBaseRepo) Revoke(projectID, userID string) error {
	if projectID == "" {
		return errors.New("projectparticipants: projectID is required")
	}
	if userID == "" {
		return errors.New("projectparticipants: userID is required")
	}

	record, err := r.app.FindFirstRecordByFilter(
		CollectionName,
		"project = {:project} && user = {:user} && removed_at = ''",
		dbx.Params{"project": projectID, "user": userID},
	)
	if err != nil || record == nil {
		return ErrParticipantNotFound
	}

	record.Set("removed_at", time.Now().UTC())
	return r.app.Save(record)
}

// ListActive returns the currently-active participants for the project,
// ordered by added_at ascending so older members (notably the creator) come
// first.
func (r *PocketBaseRepo) ListActive(projectID string) ([]Membership, error) {
	if projectID == "" {
		return nil, nil
	}

	records, err := r.app.FindRecordsByFilter(
		CollectionName,
		"project = {:project} && removed_at = ''",
		"added_at",
		200,
		0,
		dbx.Params{"project": projectID},
	)
	if err != nil {
		return nil, err
	}

	members := make([]Membership, 0, len(records))
	for _, record := range records {
		members = append(members, Membership{
			ID:        record.Id,
			ProjectID: record.GetString("project"),
			UserID:    record.GetString("user"),
			Role:      Role(record.GetString("role")),
			AddedAt:   record.GetString("added_at"),
		})
	}
	return members, nil
}
