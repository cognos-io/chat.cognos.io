package handler

import (
	"net/http"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/projectparticipants"
)

// Scoped redaction: user- and project-scoped token→original maps so a PII
// placeholder pinned to user/project memory hydrates wherever that scope is
// shown (closes the project-redaction-keys gap). Mirrors the conversation
// redaction handlers; the server only ever stores tokens + sealed originals.

const (
	userRedactionEntriesCollection    = "user_redaction_entries"
	projectRedactionKeysCollection    = "project_redaction_keys"
	projectRedactionEntriesCollection = "project_redaction_entries"
)

// --- User redaction entries (sealed to the user's own key) ---

// UserRedactionEntriesList returns the caller's sealed token→original maps.
func UserRedactionEntriesList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		records, err := app.FindAllRecords(
			userRedactionEntriesCollection,
			dbx.HashExp{"user": user.ID},
		)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list redaction entries", err)
		}
		items := make([]redactionEntryResponse, 0, len(records))
		for _, record := range records {
			items = append(items, redactionEntryToResponse(record))
		}
		return e.JSON(http.StatusOK, listRedactionEntriesResponse{Items: items})
	}
}

// UserRedactionEntriesCreate persists new sealed maps for the caller, idempotent
// per token.
func UserRedactionEntriesCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		entries, err := bindRedactionEntries(e)
		if err != nil {
			return err
		}
		collection, err := app.FindCollectionByNameOrId(userRedactionEntriesCollection)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load collection", err)
		}
		created, err := insertRedactionEntries(app, collection, entries, func(record *core.Record) {
			record.Set("user", user.ID)
		}, "user = {:owner} && token = {:token}", func() dbx.Params {
			return dbx.Params{"owner": user.ID}
		})
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to store redaction entries", err)
		}
		return e.JSON(http.StatusCreated, map[string]any{"created": created})
	}
}

// UserRedactionEntryDelete removes one caller-owned user-scoped redaction entry
// by token. The token is not sensitive: it is already stored plaintext for
// redaction lookup, while the original value remains sealed in data.
func UserRedactionEntryDelete(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		token := strings.TrimSpace(e.Request.PathValue("token"))
		if token == "" {
			return apis.NewBadRequestError("token is required", nil)
		}
		record, err := app.FindFirstRecordByFilter(
			userRedactionEntriesCollection,
			"user = {:owner} && token = {:token}",
			dbx.Params{"owner": user.ID, "token": token},
		)
		if err != nil || record == nil {
			return apis.NewNotFoundError("Redaction entry not found", nil)
		}
		if err := app.Delete(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete redaction entry", err)
		}
		return e.NoContent(http.StatusNoContent)
	}
}

// --- Project redaction keypair (wrapped per active member) ---

func projectKeyVersion(record *core.Record) int {
	if v := record.GetInt("key_version"); v >= 1 {
		return v
	}
	return 1
}

// ProjectRedactionKeyGet returns the caller's wrapped redaction key + the project
// redaction public key. 404 when not a member or no key exists yet.
func ProjectRedactionKeyGet(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		projectID := strings.TrimSpace(e.Request.PathValue("projectID"))
		userID, err := projectMemberOr404(app, e, projectID)
		if err != nil {
			return err
		}
		project, err := app.FindRecordById("projects", projectID)
		if err != nil {
			return apis.NewNotFoundError("Project not found", nil)
		}
		record, err := app.FindFirstRecordByFilter(
			projectRedactionKeysCollection,
			"project = {:project} && user = {:user} && key_version = {:version}",
			dbx.Params{"project": projectID, "user": userID, "version": projectKeyVersion(project)},
		)
		if err != nil || record == nil {
			return apis.NewNotFoundError("Redaction key not found", nil)
		}
		return e.JSON(http.StatusOK, redactionKeyResponse{
			PublicKey:        record.GetString("public_key"),
			WrappedSecretKey: record.GetString("wrapped_secret_key"),
			KeyVersion:       redactionKeyVersion(record),
		})
	}
}

// ProjectRedactionKeyCreate stores a project redaction keypair: a shared public
// key + one wrapped secret per active member who gets mapping access. Create-once
// per generation (409 on conflict). The client does all the crypto.
func ProjectRedactionKeyCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		projectID := strings.TrimSpace(e.Request.PathValue("projectID"))
		callerID, err := projectMemberOr404(app, e, projectID)
		if err != nil {
			return err
		}
		project, err := app.FindRecordById("projects", projectID)
		if err != nil {
			return apis.NewNotFoundError("Project not found", nil)
		}

		var req createRedactionKeyRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		req.PublicKey = strings.TrimSpace(req.PublicKey)
		if req.PublicKey == "" {
			return apis.NewBadRequestError("public_key is required", nil)
		}
		if len(req.Keys) == 0 {
			return apis.NewBadRequestError("at least one wrapped key is required", nil)
		}

		keyVersion := projectKeyVersion(project)
		if existing, _ := app.FindFirstRecordByFilter(
			projectRedactionKeysCollection,
			"project = {:project} && key_version = {:version}",
			dbx.Params{"project": projectID, "version": keyVersion},
		); existing != nil {
			return apis.NewApiError(http.StatusConflict, "Redaction key already exists for this generation", nil)
		}

		participants := projectparticipants.NewPocketBaseRepo(app)
		callerIncluded := false
		for i := range req.Keys {
			req.Keys[i].UserID = strings.TrimSpace(req.Keys[i].UserID)
			req.Keys[i].WrappedSecretKey = strings.TrimSpace(req.Keys[i].WrappedSecretKey)
			if req.Keys[i].UserID == "" || req.Keys[i].WrappedSecretKey == "" {
				return apis.NewBadRequestError("each key requires user_id and wrapped_secret_key", nil)
			}
			active, err := participants.IsActive(projectID, req.Keys[i].UserID)
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to verify member", err)
			}
			if !active {
				return apis.NewBadRequestError("wrapped key targets a non-member", nil)
			}
			if req.Keys[i].UserID == callerID {
				callerIncluded = true
			}
		}
		if !callerIncluded {
			return apis.NewBadRequestError("caller must be included in the wrapped keys", nil)
		}

		collection, err := app.FindCollectionByNameOrId(projectRedactionKeysCollection)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load redaction keys collection", err)
		}
		if err := app.RunInTransaction(func(txApp core.App) error {
			for _, k := range req.Keys {
				record := core.NewRecord(collection)
				record.Set("project", projectID)
				record.Set("user", k.UserID)
				record.Set("key_version", keyVersion)
				record.Set("public_key", req.PublicKey)
				record.Set("wrapped_secret_key", k.WrappedSecretKey)
				if err := txApp.Save(record); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to store redaction key", err)
		}
		return e.JSON(http.StatusCreated, createRedactionKeyResponse{KeyVersion: keyVersion})
	}
}

// --- Project redaction entries (sealed to the project redaction key) ---

// ProjectRedactionEntriesList returns a project's sealed token→original maps to
// any active member.
func ProjectRedactionEntriesList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		projectID := strings.TrimSpace(e.Request.PathValue("projectID"))
		if _, err := projectMemberOr404(app, e, projectID); err != nil {
			return err
		}
		records, err := app.FindAllRecords(
			projectRedactionEntriesCollection,
			dbx.HashExp{"project": projectID},
		)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list redaction entries", err)
		}
		items := make([]redactionEntryResponse, 0, len(records))
		for _, record := range records {
			items = append(items, redactionEntryToResponse(record))
		}
		return e.JSON(http.StatusOK, listRedactionEntriesResponse{Items: items})
	}
}

// ProjectRedactionEntriesCreate persists new sealed maps for a project, idempotent
// per token. Stamped with the project's current key generation.
func ProjectRedactionEntriesCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		projectID := strings.TrimSpace(e.Request.PathValue("projectID"))
		if _, err := projectMemberOr404(app, e, projectID); err != nil {
			return err
		}
		project, err := app.FindRecordById("projects", projectID)
		if err != nil {
			return apis.NewNotFoundError("Project not found", nil)
		}
		entries, err := bindRedactionEntries(e)
		if err != nil {
			return err
		}
		collection, err := app.FindCollectionByNameOrId(projectRedactionEntriesCollection)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load collection", err)
		}
		keyVersion := projectKeyVersion(project)
		created, err := insertRedactionEntries(app, collection, entries, func(record *core.Record) {
			record.Set("project", projectID)
			record.Set("key_version", keyVersion)
		}, "project = {:owner} && token = {:token}", func() dbx.Params {
			return dbx.Params{"owner": projectID}
		})
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to store redaction entries", err)
		}
		return e.JSON(http.StatusCreated, map[string]any{"created": created})
	}
}

// --- shared helpers ---

func bindRedactionEntries(e *core.RequestEvent) ([]redactionEntryInput, error) {
	var req createRedactionEntriesRequest
	if err := e.BindBody(&req); err != nil {
		return nil, apis.NewBadRequestError("Failed to read request data", err)
	}
	if len(req.Entries) == 0 {
		return nil, apis.NewBadRequestError("at least one entry is required", nil)
	}
	for i := range req.Entries {
		req.Entries[i].Token = strings.TrimSpace(req.Entries[i].Token)
		req.Entries[i].Data = strings.TrimSpace(req.Entries[i].Data)
		if req.Entries[i].Token == "" || req.Entries[i].Data == "" {
			return nil, apis.NewBadRequestError("each entry requires token and data", nil)
		}
	}
	return req.Entries, nil
}

// insertRedactionEntries idempotently stores entries (skipping existing tokens
// for the owner), setting owner fields via `setOwner`. `existsFilter` must use
// {:owner} and {:token}; `ownerParam` supplies {:owner}.
func insertRedactionEntries(
	app core.App,
	collection *core.Collection,
	entries []redactionEntryInput,
	setOwner func(*core.Record),
	existsFilter string,
	ownerParam func() dbx.Params,
) ([]string, error) {
	created := make([]string, 0, len(entries))
	err := app.RunInTransaction(func(txApp core.App) error {
		for _, entry := range entries {
			params := ownerParam()
			params["token"] = entry.Token
			if existing, _ := txApp.FindFirstRecordByFilter(collection.Name, existsFilter, params); existing != nil {
				continue
			}
			record := core.NewRecord(collection)
			setOwner(record)
			record.Set("token", entry.Token)
			record.Set("data", entry.Data)
			if err := txApp.Save(record); err != nil {
				return err
			}
			created = append(created, entry.Token)
		}
		return nil
	})
	return created, err
}
