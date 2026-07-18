package handler

import (
	"net/http"
	"strings"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/projectparticipants"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

type rotateProjectKeyRequest struct {
	// NewVersion must be exactly current+1. The client drives the version
	// so the server can reject stale or replayed rotation payloads.
	NewVersion int `json:"new_key_version"`
	// WrappedProjectKeys carries a fresh wrapping for EVERY remaining active
	// participant. The server validates completeness so no participant is
	// ever locked out of the new generation.
	WrappedProjectKeys []rotateProjectKeyEntry `json:"wrapped_project_keys"`
	// RewrappedConversationKeys carries the secret key for every project
	// conversation re-encrypted under the new project content key.
	RewrappedConversationKeys []rotateProjectConversationKeyEntry `json:"rewrapped_conversation_keys"`
}

type rotateProjectKeyEntry struct {
	UserID            string `json:"user_id"`
	WrappedProjectKey string `json:"wrapped_project_key"`
}

type rotateProjectConversationKeyEntry struct {
	ConversationID   string `json:"conversation_id"`
	WrappedSecretKey string `json:"wrapped_secret_key"`
}

type rotateProjectKeyResponse struct {
	ProjectID                 string                              `json:"project_id"`
	KeyVersion                int                                 `json:"key_version"`
	WrappedProjectKeys        []rotateProjectKeyEntry             `json:"wrapped_project_keys"`
	RewrappedConversationKeys []rotateProjectConversationKeyEntry `json:"rewrapped_conversation_keys"`
}

// ProjectKeyRotate bumps the project's key_version, persists fresh
// per-participant wrapped project keys for every remaining active participant,
// and rewraps every project conversation's secret key under the new project
// content key. Caller (project Admin or org admin) must provide a wrapping for
// EVERY active participant and a rewrapped key for EVERY project conversation;
// missing or extra entries are rejected so the rotation can never leave data
// inaccessible.
//
// All mutations happen inside a single transaction: version bump, wrappings
// replacement, and conversation rewrappings are atomic.
func ProjectKeyRotate(app core.App) func(e *core.RequestEvent) error {
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
			return apis.NewForbiddenError("Only project admins can rotate the key", nil)
		}

		var req rotateProjectKeyRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		if len(req.WrappedProjectKeys) == 0 {
			return apis.NewBadRequestError("wrapped_project_keys is required", nil)
		}
		// An empty rewrapped_conversation_keys list is valid only for a project
		// with no conversations — the coverage check below owns that rule.

		currentVersion := project.GetInt("key_version")
		if currentVersion < 1 {
			currentVersion = 1
		}
		if req.NewVersion != currentVersion+1 {
			return apis.NewBadRequestError("new_key_version must be current+1", nil)
		}

		repo := projectparticipants.NewPocketBaseRepo(app)
		members, err := repo.ListActive(projectID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to enumerate project participants", err)
		}

		// Build the expected active set.
		active := make(map[string]struct{}, len(members))
		for _, m := range members {
			active[m.UserID] = struct{}{}
		}

		// Validate wrapped_project_keys covers exactly the active set.
		seenWrappings := make(map[string]string, len(req.WrappedProjectKeys))
		for _, entry := range req.WrappedProjectKeys {
			userID := strings.TrimSpace(entry.UserID)
			wrapped := strings.TrimSpace(entry.WrappedProjectKey)
			if userID == "" || wrapped == "" {
				return apis.NewBadRequestError("Each wrapped_project_keys entry needs a non-empty user_id and wrapped_project_key", nil)
			}
			if _, ok := active[userID]; !ok {
				return apis.NewBadRequestError("wrapped_project_keys entry targets a non-participant", nil)
			}
			if _, dup := seenWrappings[userID]; dup {
				return apis.NewBadRequestError("wrapped_project_keys contains a duplicate user_id", nil)
			}
			seenWrappings[userID] = wrapped
		}
		if len(seenWrappings) != len(active) {
			return apis.NewBadRequestError("wrapped_project_keys must cover every active participant", nil)
		}

		// Validate rewrapped_conversation_keys covers every project conversation.
		conversationIDs, err := projectConversationIDs(app, projectID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list project conversations", err)
		}

		expectedConvs := make(map[string]struct{}, len(conversationIDs))
		for _, cid := range conversationIDs {
			expectedConvs[cid] = struct{}{}
		}

		seenConvs := make(map[string]string, len(req.RewrappedConversationKeys))
		for _, entry := range req.RewrappedConversationKeys {
			cid := strings.TrimSpace(entry.ConversationID)
			wrapped := strings.TrimSpace(entry.WrappedSecretKey)
			if cid == "" || wrapped == "" {
				return apis.NewBadRequestError("Each rewrapped_conversation_keys entry needs a non-empty conversation_id and wrapped_secret_key", nil)
			}
			if _, ok := expectedConvs[cid]; !ok {
				return apis.NewBadRequestError("rewrapped_conversation_keys entry targets a non-project conversation", nil)
			}
			if _, dup := seenConvs[cid]; dup {
				return apis.NewBadRequestError("rewrapped_conversation_keys contains a duplicate conversation_id", nil)
			}
			seenConvs[cid] = wrapped
		}
		if len(seenConvs) != len(expectedConvs) {
			return apis.NewBadRequestError("rewrapped_conversation_keys must cover every project conversation", nil)
		}

		wrappingsCollection, err := app.FindCollectionByNameOrId(projectKeyWrappingsCollection)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load project key wrappings collection", err)
		}
		convKeysCollection, err := app.FindCollectionByNameOrId("project_conversation_keys")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load project conversation keys collection", err)
		}

		if err := app.RunInTransaction(func(txApp core.App) error {
			// Bump the project's key version.
			project.Set("key_version", req.NewVersion)
			if err := txApp.Save(project); err != nil {
				return err
			}

			// Write fresh wrappings for every active participant at the
			// new version. Old wrappings for revoked users stay in the DB
			// as audit data but are unreachable for future content.
			for userID, wrapped := range seenWrappings {
				wrappingRecord := core.NewRecord(wrappingsCollection)
				wrappingRecord.Set("project", projectID)
				wrappingRecord.Set("user", userID)
				wrappingRecord.Set("wrapped_project_key", wrapped)
				wrappingRecord.Set("key_version", req.NewVersion)
				if err := txApp.Save(wrappingRecord); err != nil {
					return err
				}
			}

			// Write rewrapped conversation keys at the new project version.
			for cid, wrapped := range seenConvs {
				convKeyRecord := core.NewRecord(convKeysCollection)
				convKeyRecord.Set("project", projectID)
				convKeyRecord.Set("conversation", cid)
				convKeyRecord.Set("project_key_version", req.NewVersion)
				convKeyRecord.Set("wrapped_conversation_secret_key", wrapped)
				// conversation_key_version stays unchanged — only the
				// project key rotated, not the conversation key itself.
				if err := txApp.Save(convKeyRecord); err != nil {
					return err
				}
			}

			return nil
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to rotate project key", err)
		}

		return e.JSON(http.StatusOK, rotateProjectKeyResponse{
			ProjectID:                 projectID,
			KeyVersion:                req.NewVersion,
			WrappedProjectKeys:        req.WrappedProjectKeys,
			RewrappedConversationKeys: req.RewrappedConversationKeys,
		})
	}
}

// projectConversationIDs returns the conversation IDs belonging to the project.
func projectConversationIDs(app core.App, projectID string) ([]string, error) {
	type row struct {
		ID string `db:"id"`
	}
	var rows []row
	if err := app.DB().
		Select("id").
		From("conversations").
		Where(dbx.HashExp{"project": projectID}).
		All(&rows); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	return ids, nil
}
