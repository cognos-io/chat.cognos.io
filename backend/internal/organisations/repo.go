// Package organisations exposes the read/write surface for the organisations
// and org_memberships collections. It is the single source of truth for "is
// this user an active member of this organisation" — handlers consult
// IsActiveMember / ActiveRole instead of doing their own row checks, so
// membership semantics (soft revoke via removed_at) live in exactly one place.
//
// It mirrors the conversation- and project-scoped participant packages; the
// three are kept separate rather than generalised so the security-critical
// access filter for each resource stays explicit and independently testable.
//
// Organisation names are plaintext operational metadata (an Organisation is
// not content) but must never be logged alongside user content.
package organisations

import (
	"errors"
	"sort"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Role mirrors the select values defined on the org_memberships collection.
// Keep these strings in sync with the migration's enum.
type Role string

const (
	RoleOwner  Role = "owner"
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
)

// CanManage reports whether the role may administer the organisation
// (rename, and in later slices: members, seats, policy).
func (r Role) CanManage() bool {
	return r == RoleOwner || r == RoleAdmin
}

// CollectionName is the organisations PocketBase collection name. Kept as a
// package constant so handlers and tests cannot accidentally diverge from the
// migration.
const CollectionName = "organisations"

// MembershipsCollectionName is the org_memberships PocketBase collection name.
const MembershipsCollectionName = "org_memberships"

// Organisation is the read-shape of a single organisations row.
type Organisation struct {
	ID      string
	Name    string
	OwnerID string
	Created string
	Updated string
}

// Membership is the read-shape of a single active org_memberships row.
type Membership struct {
	ID             string
	OrganisationID string
	UserID         string
	Role           Role
	AddedAt        string
}

// UserOrganisation is an organisation joined with the requesting user's own
// active role in it — the shape the "my organisations" list needs.
type UserOrganisation struct {
	Organisation
	Role Role
}

// Repo is the read/write surface for organisations and their memberships.
type Repo interface {
	// Create inserts a new organisation owned by ownerID together with the
	// owner's active membership row, in a single transaction — an
	// organisation without an owner member would be invisible to its own
	// creator.
	Create(name, ownerID string) (Organisation, error)

	// Rename updates the organisation's name. It performs no access check;
	// callers must have already authorised the caller via ActiveRole.
	Rename(orgID, name string) (Organisation, error)

	// GetForUser returns the organisations where the user currently holds an
	// active membership (removed_at empty), each with the user's role.
	GetForUser(userID string) ([]UserOrganisation, error)

	// ActiveRole returns the role the user currently holds in the
	// organisation. The second return is false when the user is not an
	// active member.
	ActiveRole(orgID, userID string) (Role, bool, error)

	// IsActiveMember reports whether the user currently belongs to the
	// organisation. A row with a non-empty removed_at counts as revoked.
	IsActiveMember(orgID, userID string) (bool, error)

	// ListMembers returns all currently-active members of the organisation
	// (removed_at is empty), ordered by added_at ascending so the owner
	// comes first.
	ListMembers(orgID string) ([]Membership, error)

	// ReactivateOrCreateMembership clears removed_at on an existing revoked
	// row, or inserts a new active membership. It returns the role of the
	// resulting row (the original role is preserved on reactivation so a
	// re-invite cannot escalate privileges).
	ReactivateOrCreateMembership(orgID, userID string) (Role, error)

	// OrgProjectIDs returns the IDs of projects owned by the organisation.
	OrgProjectIDs(orgID string) ([]string, error)
}

// PocketBaseRepo is the production implementation backed by the PocketBase app.
type PocketBaseRepo struct {
	app core.App
}

// NewPocketBaseRepo wires a Repo against the running PocketBase app.
func NewPocketBaseRepo(app core.App) *PocketBaseRepo {
	return &PocketBaseRepo{app: app}
}

// Create saves the organisation and its owner membership atomically. Both
// rows land together or none do.
func (r *PocketBaseRepo) Create(name, ownerID string) (Organisation, error) {
	if name == "" {
		return Organisation{}, errors.New("organisations: name is required")
	}
	if ownerID == "" {
		return Organisation{}, errors.New("organisations: ownerID is required")
	}

	orgCollection, err := r.app.FindCollectionByNameOrId(CollectionName)
	if err != nil {
		return Organisation{}, err
	}
	membershipCollection, err := r.app.FindCollectionByNameOrId(MembershipsCollectionName)
	if err != nil {
		return Organisation{}, err
	}

	record := core.NewRecord(orgCollection)
	record.Set("name", name)
	record.Set("owner", ownerID)

	if err := r.app.RunInTransaction(func(txApp core.App) error {
		if err := txApp.Save(record); err != nil {
			return err
		}

		membership := core.NewRecord(membershipCollection)
		membership.Set("organisation", record.Id)
		membership.Set("user", ownerID)
		membership.Set("role", string(RoleOwner))
		membership.Set("added_at", time.Now().UTC())
		return txApp.Save(membership)
	}); err != nil {
		return Organisation{}, err
	}

	return recordToOrganisation(record), nil
}

// Rename updates the organisation name. Validation (length bounds) is
// enforced by the collection schema on save.
func (r *PocketBaseRepo) Rename(orgID, name string) (Organisation, error) {
	if orgID == "" {
		return Organisation{}, errors.New("organisations: orgID is required")
	}
	if name == "" {
		return Organisation{}, errors.New("organisations: name is required")
	}

	record, err := r.app.FindRecordById(CollectionName, orgID)
	if err != nil {
		return Organisation{}, err
	}

	record.Set("name", name)
	if err := r.app.Save(record); err != nil {
		return Organisation{}, err
	}
	return recordToOrganisation(record), nil
}

// GetForUser returns the user's organisations with their role, oldest first
// (stable ordering for the workspace switcher).
func (r *PocketBaseRepo) GetForUser(userID string) ([]UserOrganisation, error) {
	if userID == "" {
		return nil, errors.New("organisations: userID is required")
	}

	memberships, err := r.app.FindRecordsByFilter(
		MembershipsCollectionName,
		"user = {:user} && removed_at = ''",
		"added_at",
		0,
		0,
		dbx.Params{"user": userID},
	)
	if err != nil {
		return nil, err
	}
	if len(memberships) == 0 {
		return []UserOrganisation{}, nil
	}

	roleByOrgID := make(map[string]Role, len(memberships))
	orgIDs := make([]string, 0, len(memberships))
	for _, membership := range memberships {
		orgID := membership.GetString("organisation")
		roleByOrgID[orgID] = Role(membership.GetString("role"))
		orgIDs = append(orgIDs, orgID)
	}

	records, err := r.app.FindRecordsByIds(CollectionName, orgIDs)
	if err != nil {
		return nil, err
	}
	sort.Slice(records, func(i, j int) bool {
		return records[i].GetString("created") < records[j].GetString("created")
	})

	organisations := make([]UserOrganisation, 0, len(records))
	for _, record := range records {
		organisations = append(organisations, UserOrganisation{
			Organisation: recordToOrganisation(record),
			Role:         roleByOrgID[record.Id],
		})
	}
	return organisations, nil
}

// ActiveRole returns the user's current role in the organisation. The second
// return is false when no active row exists; the Role is empty in that case
// and callers must treat the user as having no access.
func (r *PocketBaseRepo) ActiveRole(orgID, userID string) (Role, bool, error) {
	record, err := r.activeMembershipRecord(orgID, userID)
	if err != nil || record == nil {
		return "", false, nil
	}
	return Role(record.GetString("role")), true, nil
}

// IsActiveMember returns true when the user has a membership row for the
// organisation that has not been revoked (removed_at is empty).
func (r *PocketBaseRepo) IsActiveMember(orgID, userID string) (bool, error) {
	record, err := r.activeMembershipRecord(orgID, userID)
	if err != nil {
		// PocketBase returns a not-found error when no row matches. The
		// caller wants a boolean, so we treat absence as "not a member"
		// rather than propagating.
		return false, nil
	}
	return record != nil, nil
}

// ListMembers returns the currently-active members of the organisation,
// ordered by added_at ascending so older members (notably the owner) come
// first.
func (r *PocketBaseRepo) ListMembers(orgID string) ([]Membership, error) {
	if orgID == "" {
		return nil, errors.New("organisations: orgID is required")
	}

	records, err := r.app.FindRecordsByFilter(
		MembershipsCollectionName,
		"organisation = {:organisation} && removed_at = ''",
		"added_at",
		0,
		0,
		dbx.Params{"organisation": orgID},
	)
	if err != nil {
		return nil, err
	}

	members := make([]Membership, 0, len(records))
	for _, record := range records {
		members = append(members, Membership{
			ID:             record.Id,
			OrganisationID: record.GetString("organisation"),
			UserID:         record.GetString("user"),
			Role:           Role(record.GetString("role")),
			AddedAt:        record.GetString("added_at"),
		})
	}
	return members, nil
}

// ReactivateOrCreateMembership reactivates an existing revoked membership
// row (clearing removed_at) or creates a new one. The original role is
// preserved on reactivation so a re-invite cannot escalate privileges.
func (r *PocketBaseRepo) ReactivateOrCreateMembership(orgID, userID string) (Role, error) {
	if orgID == "" || userID == "" {
		return "", errors.New("organisations: orgID and userID are required")
	}

	existing, err := r.app.FindFirstRecordByFilter(
		MembershipsCollectionName,
		"organisation = {:organisation} && user = {:user}",
		dbx.Params{"organisation": orgID, "user": userID},
	)
	if err == nil && existing != nil {
		existing.Set("removed_at", "")
		if err := r.app.Save(existing); err != nil {
			return "", err
		}
		return Role(existing.GetString("role")), nil
	}

	membershipCollection, err := r.app.FindCollectionByNameOrId(MembershipsCollectionName)
	if err != nil {
		return "", err
	}

	record := core.NewRecord(membershipCollection)
	record.Set("organisation", orgID)
	record.Set("user", userID)
	record.Set("role", string(RoleMember))
	record.Set("added_at", time.Now().UTC())
	if err := r.app.Save(record); err != nil {
		return "", err
	}
	return RoleMember, nil
}

// OrgProjectIDs returns project IDs that belong to the organisation.
func (r *PocketBaseRepo) OrgProjectIDs(orgID string) ([]string, error) {
	if orgID == "" {
		return nil, errors.New("organisations: orgID is required")
	}

	records, err := r.app.FindRecordsByFilter(
		"projects",
		"organisation = {:organisation}",
		"", 0, 0,
		dbx.Params{"organisation": orgID},
	)
	if err != nil {
		return nil, err
	}

	ids := make([]string, 0, len(records))
	for _, rec := range records {
		ids = append(ids, rec.Id)
	}
	return ids, nil
}

func (r *PocketBaseRepo) activeMembershipRecord(orgID, userID string) (*core.Record, error) {
	if orgID == "" || userID == "" {
		return nil, nil
	}

	return r.app.FindFirstRecordByFilter(
		MembershipsCollectionName,
		"organisation = {:organisation} && user = {:user} && removed_at = ''",
		dbx.Params{"organisation": orgID, "user": userID},
	)
}

func recordToOrganisation(record *core.Record) Organisation {
	return Organisation{
		ID:      record.Id,
		Name:    record.GetString("name"),
		OwnerID: record.GetString("owner"),
		Created: record.GetString("created"),
		Updated: record.GetString("updated"),
	}
}
