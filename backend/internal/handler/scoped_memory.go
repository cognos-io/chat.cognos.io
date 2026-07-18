package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/projectparticipants"
)

// Scoped (user- and project-) memory: client-encrypted, ciphertext-only stores
// that mirror manual conversation memory, but keyed to a user or a project so
// pinned snippets follow the user across chats / the project across its
// conversations (spec §16). The server only ever stores opaque ciphertext.

const (
	userMemoryCollection    = "user_memory"
	projectMemoryCollection = "project_memory"
)

type memoryRecordResponse struct {
	ID      string `json:"id"`
	Data    string `json:"data"`
	Created string `json:"created"`
	Updated string `json:"updated"`
}

type memoryWriteRequest struct {
	Data string `json:"data"`
}

type memoryListResponse struct {
	Items []memoryRecordResponse `json:"items"`
}

func toMemoryResponse(record *core.Record) memoryRecordResponse {
	return memoryRecordResponse{
		ID:      record.Id,
		Data:    record.GetString("data"),
		Created: record.GetDateTime("created").Time().UTC().Format(time.RFC3339),
		Updated: record.GetDateTime("updated").Time().UTC().Format(time.RFC3339),
	}
}

func bindMemoryData(e *core.RequestEvent) (string, error) {
	var req memoryWriteRequest
	if err := e.BindBody(&req); err != nil {
		return "", apis.NewBadRequestError("Invalid request body", err)
	}
	data := strings.TrimSpace(req.Data)
	if data == "" {
		return "", apis.NewBadRequestError("Data is required", nil)
	}
	return data, nil
}

// --- User memory (owned by the authenticated user) ---

// UserMemoryCreate stores a client-encrypted user-memory record (sealed to the
// user's public key).
func UserMemoryCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		data, err := bindMemoryData(e)
		if err != nil {
			return err
		}

		collection, err := app.FindCollectionByNameOrId(userMemoryCollection)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load collection", err)
		}
		record := core.NewRecord(collection)
		record.Set("user", user.ID)
		record.Set("data", data)
		if err := app.Save(record); err != nil {
			return apis.NewBadRequestError("Failed to save memory", err)
		}
		return e.JSON(http.StatusOK, toMemoryResponse(record))
	}
}

// UserMemoryList returns the authenticated user's memory records.
func UserMemoryList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		records, err := app.FindRecordsByFilter(
			userMemoryCollection,
			"user = {:user}",
			"created",
			0,
			0,
			map[string]any{"user": user.ID},
		)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load memory", err)
		}
		return e.JSON(http.StatusOK, toMemoryList(records))
	}
}

// UserMemoryUpdate replaces a user-memory record's ciphertext (owner only).
func UserMemoryUpdate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		record, err := app.FindRecordById(userMemoryCollection, e.Request.PathValue("id"))
		if err != nil || record.GetString("user") != user.ID {
			return apis.NewNotFoundError("Memory not found", nil)
		}
		data, err := bindMemoryData(e)
		if err != nil {
			return err
		}
		record.Set("data", data)
		if err := app.Save(record); err != nil {
			return apis.NewBadRequestError("Failed to update memory", err)
		}
		return e.JSON(http.StatusOK, toMemoryResponse(record))
	}
}

// UserMemoryDelete removes a user-memory record (owner only).
func UserMemoryDelete(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		record, err := app.FindRecordById(userMemoryCollection, e.Request.PathValue("id"))
		if err != nil || record.GetString("user") != user.ID {
			return apis.NewNotFoundError("Memory not found", nil)
		}
		if err := app.Delete(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete memory", err)
		}
		return e.NoContent(http.StatusNoContent)
	}
}

// --- Project memory (gated by active project membership) ---

func projectMemberOr404(app core.App, e *core.RequestEvent, projectID string) (string, error) {
	user := auth.ExtractUser(e)
	if user == nil {
		return "", apis.NewUnauthorizedError("User not authenticated", nil)
	}
	active, err := projectparticipants.NewPocketBaseRepo(app).IsActive(projectID, user.ID)
	if err != nil {
		return "", apis.NewApiError(http.StatusInternalServerError, "Failed to verify project access", err)
	}
	if !active {
		// Same shape a missing project returns, so ids can't be probed.
		return "", apis.NewNotFoundError("Project not found", nil)
	}
	if e.Request.Method != http.MethodGet && e.Request.Method != http.MethodDelete {
		project, err := app.FindRecordById("projects", projectID)
		if err != nil {
			return "", apis.NewNotFoundError("Project not found", nil)
		}
		if err := requireProjectWritable(project); err != nil {
			return "", err
		}
	}
	return user.ID, nil
}

// ProjectMemoryCreate stores a client-encrypted project-memory record (sealed
// with the project content key). Any active project member may write it.
func ProjectMemoryCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		projectID := strings.TrimSpace(e.Request.PathValue("projectID"))
		if _, err := projectMemberOr404(app, e, projectID); err != nil {
			return err
		}
		data, err := bindMemoryData(e)
		if err != nil {
			return err
		}
		collection, err := app.FindCollectionByNameOrId(projectMemoryCollection)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load collection", err)
		}
		record := core.NewRecord(collection)
		record.Set("project", projectID)
		record.Set("data", data)
		if err := app.Save(record); err != nil {
			return apis.NewBadRequestError("Failed to save memory", err)
		}
		return e.JSON(http.StatusOK, toMemoryResponse(record))
	}
}

// ProjectMemoryList returns a project's memory records to any active member.
func ProjectMemoryList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		projectID := strings.TrimSpace(e.Request.PathValue("projectID"))
		if _, err := projectMemberOr404(app, e, projectID); err != nil {
			return err
		}
		records, err := app.FindRecordsByFilter(
			projectMemoryCollection,
			"project = {:project}",
			"created",
			0,
			0,
			map[string]any{"project": projectID},
		)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load memory", err)
		}
		return e.JSON(http.StatusOK, toMemoryList(records))
	}
}

// ProjectMemoryUpdate replaces a project-memory record's ciphertext (members).
func ProjectMemoryUpdate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := app.FindRecordById(projectMemoryCollection, e.Request.PathValue("id"))
		if err != nil {
			return apis.NewNotFoundError("Memory not found", nil)
		}
		if _, err := projectMemberOr404(app, e, record.GetString("project")); err != nil {
			return err
		}
		data, err := bindMemoryData(e)
		if err != nil {
			return err
		}
		record.Set("data", data)
		if err := app.Save(record); err != nil {
			return apis.NewBadRequestError("Failed to update memory", err)
		}
		return e.JSON(http.StatusOK, toMemoryResponse(record))
	}
}

// ProjectMemoryDelete removes a project-memory record (members).
func ProjectMemoryDelete(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := app.FindRecordById(projectMemoryCollection, e.Request.PathValue("id"))
		if err != nil {
			return apis.NewNotFoundError("Memory not found", nil)
		}
		if _, err := projectMemberOr404(app, e, record.GetString("project")); err != nil {
			return err
		}
		if err := app.Delete(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete memory", err)
		}
		return e.NoContent(http.StatusNoContent)
	}
}

func toMemoryList(records []*core.Record) memoryListResponse {
	items := make([]memoryRecordResponse, 0, len(records))
	for _, record := range records {
		items = append(items, toMemoryResponse(record))
	}
	return memoryListResponse{Items: items}
}
