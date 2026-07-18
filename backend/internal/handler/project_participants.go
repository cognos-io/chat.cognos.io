// Package handler exposes the HTTP surface for project participants.
// Project sharing is org-only in v1; standalone personal-project sharing is
// rejected so the security model stays simple while we ship organisation
// workspaces.
package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
	"github.com/cognos-io/chat.cognos.io/backend/internal/projectparticipants"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

type projectParticipantResponse struct {
	ID      string `json:"id"`
	Project string `json:"project,omitempty"`
	UserID  string `json:"user_id"`
	Role    string `json:"role"`
	AddedAt string `json:"added_at,omitempty"`
}

type listProjectParticipantsResponse struct {
	Participants []projectParticipantResponse `json:"participants"`
}

type createProjectParticipantRequest struct {
	UserID            string `json:"user_id"`
	Role              string `json:"role"`
	WrappedProjectKey string `json:"wrapped_project_key"`
}

// orgAdminAccessibleProjectRecord loads a project when the caller is an
// active participant OR an Owner/Admin of the owning organisation (implicit
// Project-Admin per docs/business_processes/org-project-access.md). Misses
// return a neutral 404 so project ids cannot be probed.
func orgAdminAccessibleProjectRecord(app core.App, e *core.RequestEvent, projectID string) (*core.Record, error) {
	user := auth.ExtractUser(e)
	if user == nil {
		return nil, apis.NewUnauthorizedError("User not authenticated", nil)
	}
	record, err := app.FindRecordById("projects", projectID)
	if err != nil {
		return nil, apis.NewNotFoundError("Project not found", err)
	}
	repo := projectparticipants.NewPocketBaseRepo(app)
	active, err := repo.IsActive(projectID, user.ID)
	if err != nil {
		return nil, apis.NewApiError(http.StatusInternalServerError, "Failed to verify project access", err)
	}
	if active {
		return record, nil
	}
	if ok, _ := canAdminProject(app, record, user.ID); ok {
		return record, nil
	}
	return nil, apis.NewNotFoundError("Project not found", nil)
}

// ProjectParticipantsList returns the currently-active participants for a
// project the caller can access. Non-participants get 404 — the same shape a
// missing project would return so the response can't be used to probe for
// project ids. Org admins of the owning organisation are also allowed.
func ProjectParticipantsList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		projectID := e.Request.PathValue("projectID")
		project, err := orgAdminAccessibleProjectRecord(app, e, projectID)
		if err != nil {
			return err
		}

		// Org admins of the owning org have implicit access even if they
		// are not a project participant.
		caller := auth.ExtractUser(e)
		if ok, _ := canAdminProject(app, project, caller.ID); !ok {
			// Fall back to the standard participant check.
			repo := projectparticipants.NewPocketBaseRepo(app)
			active, err := repo.IsActive(projectID, caller.ID)
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to verify project access", err)
			}
			if !active {
				return apis.NewNotFoundError("Project not found", nil)
			}
		}

		repo := projectparticipants.NewPocketBaseRepo(app)
		members, err := repo.ListActive(projectID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list project participants", err)
		}

		out := make([]projectParticipantResponse, 0, len(members))
		for _, m := range members {
			out = append(out, projectParticipantResponse{
				ID:      m.ID,
				Project: m.ProjectID,
				UserID:  m.UserID,
				Role:    string(m.Role),
				AddedAt: m.AddedAt,
			})
		}

		return e.JSON(http.StatusOK, listProjectParticipantsResponse{Participants: out})
	}
}

// ProjectParticipantsAdd is the project sharing primitive. The caller must
// be a project Admin (or an org admin of the owning org). The body carries the
// target user id, the role they should be granted, and the project content key
// wrapped for that user (computed client-side). Both the participant row and
// the wrapped key row are written inside a single PocketBase transaction.
//
// Org-owned projects: the target user MUST be an active member of that
// organisation. Personal (non-org) projects: rejected with 403 — standalone
// sharing is not shipped in v1.
func ProjectParticipantsAdd(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		projectID := e.Request.PathValue("projectID")
		project, err := orgAdminAccessibleProjectRecord(app, e, projectID)
		if err != nil {
			return err
		}

		if ok, _ := canAdminProject(app, project, caller.ID); !ok {
			// Only Admins can add participants. Anyone else gets the same
			// 403 as a flat-out unauthorized caller.
			return apis.NewForbiddenError("Only project admins can add participants", nil)
		}

		var req createProjectParticipantRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		req.UserID = strings.TrimSpace(req.UserID)
		req.Role = strings.TrimSpace(req.Role)
		req.WrappedProjectKey = strings.TrimSpace(req.WrappedProjectKey)

		if req.UserID == "" {
			return apis.NewBadRequestError("user_id is required", nil)
		}
		if req.WrappedProjectKey == "" {
			return apis.NewBadRequestError("wrapped_project_key is required", nil)
		}
		role, ok := parseProjectParticipantRole(req.Role)
		if !ok {
			return apis.NewBadRequestError("role must be one of Admin/Editor/Viewer", nil)
		}
		if req.UserID == caller.ID {
			return apis.NewBadRequestError("Caller cannot re-add themselves", nil)
		}

		if _, err := app.FindRecordById("users", req.UserID); err != nil {
			return apis.NewNotFoundError("Target user not found", err)
		}

		// Personal projects: reject — v1 only supports org sharing.
		orgID := project.GetString("organisation")
		if orgID == "" {
			return apis.NewForbiddenError("Sharing requires an organisation", nil)
		}

		// Org-owned projects: target must be an active member.
		orgRepo := organisations.NewPocketBaseRepo(app)
		isMember, err := orgRepo.IsActiveMember(orgID, req.UserID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify organisation membership", err)
		}
		if !isMember {
			return apis.NewForbiddenError("Target user is not a member of the owning organisation", nil)
		}

		keyVersion := project.GetInt("key_version")
		if keyVersion < 1 {
			keyVersion = 1
		}

		wrappingsCollection, err := app.FindCollectionByNameOrId(projectKeyWrappingsCollection)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load project key wrappings collection", err)
		}
		participantsCollection, err := app.FindCollectionByNameOrId(projectparticipants.CollectionName)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load project participants collection", err)
		}

		// The participants collection has a UNIQUE(project, user) index.
		// A previously-revoked row still exists (with removed_at stamped),
		// so a fresh insert would 500. Look up any existing row first:
		//   - active row → reject as duplicate add (400)
		//   - soft-revoked row → re-activate inside the TX below
		//   - no row → insert fresh
		var participantRecord *core.Record
		existing, _ := app.FindFirstRecordByFilter(
			projectparticipants.CollectionName,
			"project = {:project} && user = {:user}",
			dbx.Params{"project": projectID, "user": req.UserID},
		)
		if existing != nil {
			if existing.GetString("removed_at") == "" {
				return apis.NewBadRequestError("User is already an active participant", nil)
			}
			participantRecord = existing
		} else {
			participantRecord = core.NewRecord(participantsCollection)
			participantRecord.Set("project", projectID)
			participantRecord.Set("user", req.UserID)
		}
		participantRecord.Set("role", string(role))
		participantRecord.Set("added_at", time.Now().UTC())
		participantRecord.Set("removed_at", "")

		wrappingRecord := core.NewRecord(wrappingsCollection)
		wrappingRecord.Set("project", projectID)
		wrappingRecord.Set("user", req.UserID)
		wrappingRecord.Set("wrapped_project_key", req.WrappedProjectKey)
		wrappingRecord.Set("key_version", keyVersion)

		if err := app.RunInTransaction(func(txApp core.App) error {
			if err := txApp.Save(participantRecord); err != nil {
				return err
			}
			return txApp.Save(wrappingRecord)
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to add project participant", err)
		}

		return e.JSON(http.StatusCreated, projectParticipantResponse{
			ID:      participantRecord.Id,
			Project: projectID,
			UserID:  req.UserID,
			Role:    string(role),
			AddedAt: participantRecord.GetString("added_at"),
		})
	}
}

// ProjectParticipantsRevoke soft-removes a participant from a project.
// The caller must be a project Admin (or org admin). The project creator
// cannot be revoked — there must always be at least one admin lineage.
func ProjectParticipantsRevoke(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		projectID := e.Request.PathValue("projectID")
		project, err := orgAdminAccessibleProjectRecord(app, e, projectID)
		if err != nil {
			return err
		}

		if ok, _ := canAdminProject(app, project, caller.ID); !ok {
			return apis.NewForbiddenError("Only project admins can revoke participants", nil)
		}

		targetUserID := e.Request.PathValue("userID")
		if targetUserID == "" {
			return apis.NewBadRequestError("user_id is required", nil)
		}

		// Protect the project creator — they are the immutable admin anchor.
		if targetUserID == project.GetString("creator") {
			return apis.NewBadRequestError("Cannot revoke the project creator", nil)
		}

		repo := projectparticipants.NewPocketBaseRepo(app)
		if err := repo.Revoke(projectID, targetUserID); err != nil {
			if err == projectparticipants.ErrParticipantNotFound {
				return apis.NewNotFoundError("Participant not found", nil)
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to revoke participant", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}

// canAdminProject reports whether the user may administrate the project.
// This is true when the user is an active project Admin, OR when the project
// is org-owned and the user is an org Owner/Admin. The second return is the
// resolved project role (empty when not an active participant).
func canAdminProject(app core.App, project *core.Record, userID string) (bool, projectparticipants.Role) {
	repo := projectparticipants.NewPocketBaseRepo(app)
	role, ok, err := repo.ActiveRole(project.Id, userID)
	if err == nil && ok && role == projectparticipants.RoleAdmin {
		return true, role
	}

	orgID := project.GetString("organisation")
	if orgID == "" {
		return false, role
	}

	orgRepo := organisations.NewPocketBaseRepo(app)
	orgRole, _, err := orgRepo.ActiveRole(orgID, userID)
	if err != nil || orgRole == "" {
		return false, role
	}
	if orgRole.CanManage() {
		return true, role
	}
	return false, role
}

func parseProjectParticipantRole(raw string) (projectparticipants.Role, bool) {
	switch raw {
	case string(projectparticipants.RoleAdmin), string(projectparticipants.RoleEditor), string(projectparticipants.RoleViewer):
		return projectparticipants.Role(raw), true
	default:
		return "", false
	}
}
