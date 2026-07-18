package handler

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
	"github.com/cognos-io/chat.cognos.io/backend/internal/projectparticipants"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/forms"
)

// projectKeyWrappingsCollection is the collection holding the symmetric
// project content key sealed to each participant's public key.
const projectKeyWrappingsCollection = "project_key_wrappings"

type projectRecordResponse struct {
	ID      string `json:"id"`
	Created string `json:"created"`
	Updated string `json:"updated"`
	Data    string `json:"data"`
	Creator string `json:"creator,omitempty"`
	// Organisation is plaintext operational metadata: set when the Project is
	// org-owned, empty for personal Projects. The client scopes Workspaces on it.
	Organisation string `json:"organisation,omitempty"`
	// WrappedProjectKey is the symmetric project content key sealed to the
	// requesting caller's public key, at the project's current key_version.
	// It is embedded in the response so the client can decrypt `data` in a
	// single round-trip; only the caller's own secret key can open it, so
	// returning it to that same authenticated caller leaks nothing.
	WrappedProjectKey string `json:"wrapped_project_key,omitempty"`
	KeyVersion        int    `json:"key_version"`
	ArchivedAt        string `json:"archived_at,omitempty"`
	CallerRole        string `json:"caller_role,omitempty"`
}

type createProjectRequest struct {
	// Data is the encrypted project metadata blob (base64). The plaintext
	// (name/description/settings) is encrypted client-side under the project
	// content key and never reaches the server.
	Data string `json:"data"`
	// Organisation optionally makes the Project org-owned: it bills the
	// Organisation and its participants must be active org members. The
	// caller must be an active member of that Organisation.
	Organisation string `json:"organisation"`
	// WrappedProjectKey is the symmetric project content key sealed to the
	// creator's own public key (base64). Without it the creator could not
	// decrypt their own project on a fresh session, so it is mandatory and
	// written transactionally alongside the project.
	WrappedProjectKey string `json:"wrapped_project_key"`
}

type updateProjectRequest struct {
	Data string `json:"data"`
	// ArchivedAt, when set to an RFC3339 timestamp, archives the project; an
	// empty string clears it (unarchive). Operational metadata only — it is
	// not part of the encrypted blob.
	ArchivedAt string `json:"archived_at"`
}

func ProjectsList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		projectIDs, err := activeParticipantProjectIDs(app, user.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list projects", err)
		}
		if len(projectIDs) == 0 {
			return e.JSON(http.StatusOK, []projectRecordResponse{})
		}

		records, err := app.FindRecordsByIds("projects", projectIDs)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list projects", err)
		}
		sort.Slice(records, func(i, j int) bool {
			return records[i].GetString("updated") > records[j].GetString("updated")
		})

		response := make([]projectRecordResponse, 0, len(records))
		for _, record := range records {
			item := projectRecordToResponse(record)
			wrapped, err := callerWrappedProjectKey(app, record.Id, user.ID, item.KeyVersion)
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to load project key", err)
			}
			item.WrappedProjectKey = wrapped
			role, _, err := projectparticipants.NewPocketBaseRepo(app).ActiveRole(record.Id, user.ID)
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to load project role", err)
			}
			item.CallerRole = string(role)
			response = append(response, item)
		}

		return e.JSON(http.StatusOK, response)
	}
}

func ProjectsCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		var req createProjectRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		req.Data = strings.TrimSpace(req.Data)
		req.WrappedProjectKey = strings.TrimSpace(req.WrappedProjectKey)

		if req.Data == "" {
			return apis.NewBadRequestError("Project data is required", nil)
		}
		if req.WrappedProjectKey == "" {
			return apis.NewBadRequestError("wrapped_project_key is required", nil)
		}

		req.Organisation = strings.TrimSpace(req.Organisation)
		if req.Organisation != "" {
			// Only active org members may create org-owned Projects; misses get
			// the same neutral 404 as a nonexistent organisation.
			orgRepo := organisations.NewPocketBaseRepo(app)
			active, err := orgRepo.IsActiveMember(req.Organisation, user.ID)
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to verify organisation access", err)
			}
			if !active {
				return apis.NewNotFoundError("Organisation not found", nil)
			}
		}

		projectsCollection, err := app.FindCollectionByNameOrId("projects")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load projects collection", err)
		}
		participantsCollection, err := app.FindCollectionByNameOrId(projectparticipants.CollectionName)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load project participants collection", err)
		}
		wrappingsCollection, err := app.FindCollectionByNameOrId(projectKeyWrappingsCollection)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load project key wrappings collection", err)
		}

		record := core.NewRecord(projectsCollection)
		record.Set("creator", user.ID)
		record.Set("data", req.Data)
		if req.Organisation != "" {
			record.Set("organisation", req.Organisation)
		}
		record.Set("key_version", 1)

		// All three rows land together or none do: a stranded project with no
		// creator participant would be invisible (the access check would 404
		// its own creator), and a project with no key wrapping would be
		// undecryptable. The transaction makes both impossible.
		if err := app.RunInTransaction(func(txApp core.App) error {
			if err := txApp.Save(record); err != nil {
				return err
			}

			participantRecord := core.NewRecord(participantsCollection)
			participantRecord.Set("project", record.Id)
			participantRecord.Set("user", user.ID)
			participantRecord.Set("role", string(projectparticipants.RoleAdmin))
			participantRecord.Set("added_at", time.Now().UTC())
			if err := txApp.Save(participantRecord); err != nil {
				return err
			}

			wrappingRecord := core.NewRecord(wrappingsCollection)
			wrappingRecord.Set("project", record.Id)
			wrappingRecord.Set("user", user.ID)
			wrappingRecord.Set("key_version", 1)
			wrappingRecord.Set("wrapped_project_key", req.WrappedProjectKey)
			return txApp.Save(wrappingRecord)
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to create project", err)
		}

		response := projectRecordToResponse(record)
		response.WrappedProjectKey = req.WrappedProjectKey
		return e.JSON(http.StatusCreated, response)
	}
}

func ProjectsGet(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		record, err := accessibleProjectRecord(app, e, e.Request.PathValue("projectID"))
		if err != nil {
			return err
		}
		response := projectRecordToResponse(record)
		wrapped, err := callerWrappedProjectKey(app, record.Id, user.ID, response.KeyVersion)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load project key", err)
		}
		response.WrappedProjectKey = wrapped
		role, _, err := projectparticipants.NewPocketBaseRepo(app).ActiveRole(record.Id, user.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load project role", err)
		}
		response.CallerRole = string(role)
		return e.JSON(http.StatusOK, response)
	}
}

func ProjectsUpdate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := accessibleProjectRecord(app, e, e.Request.PathValue("projectID"))
		if err != nil {
			return err
		}

		var req updateProjectRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		req.Data = strings.TrimSpace(req.Data)
		if req.Data == "" {
			return apis.NewBadRequestError("Project data is required", nil)
		}

		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{
			"data":        req.Data,
			"archived_at": strings.TrimSpace(req.ArchivedAt),
		})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to update project", err)
		}

		return e.JSON(http.StatusOK, projectRecordToResponse(record))
	}
}

func ProjectsDelete(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := accessibleProjectRecord(app, e, e.Request.PathValue("projectID"))
		if err != nil {
			return err
		}

		if err := app.Delete(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete project", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}

// accessibleProjectRecord loads a project only when the caller is an active
// participant. Non-participants get 404 — the same shape a missing project
// returns — so the response can't be used to probe for project ids.
func accessibleProjectRecord(app core.App, e *core.RequestEvent, projectID string) (*core.Record, error) {
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
	if !active {
		return nil, apis.NewNotFoundError("Project not found", nil)
	}
	if orgID := record.GetString("organisation"); orgID != "" {
		if err := requireOrgMFA(app, orgID, user.ID); err != nil {
			return nil, err
		}
	}
	return record, nil
}

// activeParticipantProjectIDs returns the project IDs the user can currently
// access (active participant rows only). Read-side counterpart to
// projectparticipants.Repo.IsActive.
func activeParticipantProjectIDs(app core.App, userID string) ([]string, error) {
	if userID == "" {
		return nil, nil
	}

	rows := []struct {
		ProjectID string `db:"project"`
	}{}

	if err := app.DB().
		Select("project").
		From(projectparticipants.CollectionName).
		Where(dbx.HashExp{"user": userID}).
		AndWhere(dbx.NewExp("removed_at = ''")).
		All(&rows); err != nil {
		return nil, err
	}

	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ProjectID)
	}
	return ids, nil
}

// callerWrappedProjectKey returns the project content key sealed to the given
// user at the given key_version, or an empty string when no wrapper exists
// (e.g. a participant added before a rotation they haven't been re-wrapped
// for). A missing wrapper is not an error here — the client treats an empty
// wrapper as "cannot decrypt yet".
func callerWrappedProjectKey(app core.App, projectID, userID string, keyVersion int) (string, error) {
	record, err := app.FindFirstRecordByFilter(
		projectKeyWrappingsCollection,
		"project = {:p} && user = {:u} && key_version = {:v}",
		dbx.Params{"p": projectID, "u": userID, "v": keyVersion},
	)
	if err != nil || record == nil {
		return "", nil
	}
	return record.GetString("wrapped_project_key"), nil
}

func projectRecordToResponse(record *core.Record) projectRecordResponse {
	version := record.GetInt("key_version")
	if version < 1 {
		version = 1
	}
	return projectRecordResponse{
		ID:           record.Id,
		Created:      record.GetString("created"),
		Updated:      record.GetString("updated"),
		Data:         record.GetString("data"),
		Creator:      record.GetString("creator"),
		Organisation: record.GetString("organisation"),
		KeyVersion:   version,
		ArchivedAt:   record.GetString("archived_at"),
	}
}
