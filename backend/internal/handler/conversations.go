package handler

import (
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/participants"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/forms"
)

type conversationRecordResponse struct {
	ID             string `json:"id"`
	Created        string `json:"created"`
	Updated        string `json:"updated"`
	Data           string `json:"data"`
	Creator        string `json:"creator,omitempty"`
	ExpiryDuration string `json:"expiry_duration,omitempty"`
	// KeyVersion is the conversation's current wrapping-key generation.
	// Clients persist the version alongside any wrapped conversation
	// secret-key cache so a rotation invalidates stale wrappers on the
	// next refresh without breaking offline copies.
	KeyVersion int `json:"key_version"`
}

type createConversationRequest struct {
	Data           string `json:"data"`
	ExpiryDuration string `json:"expiry_duration,omitempty"`
}

type updateConversationRequest struct {
	Data           string `json:"data"`
	ExpiryDuration string `json:"expiry_duration,omitempty"`
}

type messageRecordResponse struct {
	ID            string `json:"id"`
	Created       string `json:"created"`
	Updated       string `json:"updated"`
	Data          string `json:"data"`
	Conversation  string `json:"conversation"`
	ParentMessage string `json:"parent_message,omitempty"`
	Expires       string `json:"expires,omitempty"`
}

type listMessagesResponse struct {
	Page       int                     `json:"page"`
	PerPage    int                     `json:"perPage"`
	TotalItems int64                   `json:"totalItems"`
	TotalPages int                     `json:"totalPages"`
	Items      []messageRecordResponse `json:"items"`
}

type updateMessageRequest struct {
	ClearExpires bool `json:"clear_expires"`
}

func ConversationsList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationIDs, err := activeParticipantConversationIDs(app, user.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list conversations", err)
		}
		if len(conversationIDs) == 0 {
			return e.JSON(http.StatusOK, []conversationRecordResponse{})
		}

		records, err := app.FindRecordsByIds("conversations", conversationIDs)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list conversations", err)
		}
		sort.Slice(records, func(i, j int) bool {
			return records[i].GetString("updated") > records[j].GetString("updated")
		})

		response := make([]conversationRecordResponse, 0, len(records))
		for _, record := range records {
			response = append(response, conversationRecordToResponse(record))
		}

		return e.JSON(http.StatusOK, response)
	}
}

func ConversationsCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		var req createConversationRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		if strings.TrimSpace(req.Data) == "" {
			return apis.NewBadRequestError("Conversation data is required", nil)
		}
		if !isValidExpiryDuration(req.ExpiryDuration) {
			return apis.NewBadRequestError("Invalid expiry duration", nil)
		}

		collection, err := app.FindCollectionByNameOrId("conversations")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load conversations collection", err)
		}

		record := core.NewRecord(collection)
		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{
			"creator":         user.ID,
			"data":            req.Data,
			"expiry_duration": req.ExpiryDuration,
			"key_version":     1,
		})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to create conversation", err)
		}

		// Seed the creator as the conversation's first Admin participant. This
		// keeps access driven by the participants table rather than a creator
		// shortcut, so future sharing (additional participants) reuses the
		// same access path without a handler rewrite.
		repo := participants.NewPocketBaseRepo(app)
		if err := repo.Add(record.Id, user.ID, participants.RoleAdmin); err != nil {
			// Roll back the conversation row so the creator does not end up
			// locked out of a conversation they just created.
			_ = app.Delete(record)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to register conversation participant", err)
		}

		return e.JSON(http.StatusCreated, conversationRecordToResponse(record))
	}
}

func ConversationsUpdate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := ownedConversationRecord(app, e, e.Request.PathValue("conversationID"))
		if err != nil {
			return err
		}

		var req updateConversationRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		if strings.TrimSpace(req.Data) == "" {
			return apis.NewBadRequestError("Conversation data is required", nil)
		}
		if !isValidExpiryDuration(req.ExpiryDuration) {
			return apis.NewBadRequestError("Invalid expiry duration", nil)
		}

		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{
			"data":            req.Data,
			"expiry_duration": req.ExpiryDuration,
		})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to update conversation", err)
		}

		return e.JSON(http.StatusOK, conversationRecordToResponse(record))
	}
}

func ConversationsDelete(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := ownedConversationRecord(app, e, e.Request.PathValue("conversationID"))
		if err != nil {
			return err
		}

		if err := app.Delete(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete conversation", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}

func ConversationMessagesList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		conversationID := e.Request.PathValue("conversationID")
		if _, err := ownedConversationRecord(app, e, conversationID); err != nil {
			return err
		}

		page := parsePositiveIntOrDefault(e.Request.URL.Query().Get("page"), 1)
		perPage := parsePositiveIntOrDefault(e.Request.URL.Query().Get("page_size"), 100)
		if perPage > 100 {
			perPage = 100
		}
		offset := (page - 1) * perPage

		expr := dbx.NewExp("conversation = {:conversation_id}", dbx.Params{"conversation_id": conversationID})
		totalItems, err := app.CountRecords("messages", expr)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to count messages", err)
		}

		records, err := app.FindAllRecords(
			"messages",
			dbx.HashExp{"conversation": conversationID},
		)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list messages", err)
		}
		sort.Slice(records, func(i, j int) bool {
			return records[i].GetString("created") > records[j].GetString("created")
		})
		start := offset
		if start > len(records) {
			start = len(records)
		}
		end := offset + perPage
		if end > len(records) {
			end = len(records)
		}

		items := make([]messageRecordResponse, 0, end-start)
		for _, record := range records[start:end] {
			items = append(items, messageRecordToResponse(record))
		}

		totalPages := 0
		if totalItems > 0 {
			totalPages = int(math.Ceil(float64(totalItems) / float64(perPage)))
		}

		return e.JSON(http.StatusOK, listMessagesResponse{
			Page:       page,
			PerPage:    perPage,
			TotalItems: totalItems,
			TotalPages: totalPages,
			Items:      items,
		})
	}
}

func MessagesDelete(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := ownedMessageRecord(app, e, e.Request.PathValue("messageID"))
		if err != nil {
			return err
		}

		if err := app.Delete(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete message", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}

func MessagesUpdate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := ownedMessageRecord(app, e, e.Request.PathValue("messageID"))
		if err != nil {
			return err
		}

		var req updateMessageRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if !req.ClearExpires {
			return apis.NewBadRequestError("clear_expires must be true", nil)
		}

		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{"expires": nil})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to update message", err)
		}

		return e.JSON(http.StatusOK, messageRecordToResponse(record))
	}
}

func ownedConversationRecord(app core.App, e *core.RequestEvent, conversationID string) (*core.Record, error) {
	user := auth.ExtractUser(e)
	if user == nil {
		return nil, apis.NewUnauthorizedError("User not authenticated", nil)
	}
	record, err := app.FindRecordById("conversations", conversationID)
	if err != nil {
		return nil, apis.NewNotFoundError("Conversation not found", err)
	}
	repo := participants.NewPocketBaseRepo(app)
	active, err := repo.IsActive(conversationID, user.ID)
	if err != nil {
		return nil, apis.NewApiError(http.StatusInternalServerError, "Failed to verify conversation access", err)
	}
	if !active {
		return nil, apis.NewNotFoundError("Conversation not found", nil)
	}
	return record, nil
}

func ownedMessageRecord(app core.App, e *core.RequestEvent, messageID string) (*core.Record, error) {
	user := auth.ExtractUser(e)
	if user == nil {
		return nil, apis.NewUnauthorizedError("User not authenticated", nil)
	}
	record, err := app.FindRecordById("messages", messageID)
	if err != nil {
		return nil, apis.NewNotFoundError("Message not found", err)
	}
	conversationID := record.GetString("conversation")
	if _, err := app.FindRecordById("conversations", conversationID); err != nil {
		return nil, apis.NewNotFoundError("Message not found", err)
	}
	repo := participants.NewPocketBaseRepo(app)
	active, err := repo.IsActive(conversationID, user.ID)
	if err != nil {
		return nil, apis.NewApiError(http.StatusInternalServerError, "Failed to verify message access", err)
	}
	if !active {
		return nil, apis.NewNotFoundError("Message not found", nil)
	}
	return record, nil
}

// activeParticipantConversationIDs returns the conversation IDs the user can
// currently access (active participant rows only). It is the read-side
// counterpart to participants.Repo.IsActive — a dedicated helper keeps the
// list handler from having to know the PocketBase filter syntax.
func activeParticipantConversationIDs(app core.App, userID string) ([]string, error) {
	if userID == "" {
		return nil, nil
	}

	rows := []struct {
		ConversationID string `db:"conversation"`
	}{}

	if err := app.DB().
		Select("conversation").
		From(participants.CollectionName).
		Where(dbx.HashExp{"user": userID}).
		AndWhere(dbx.NewExp("removed_at = ''")).
		All(&rows); err != nil {
		return nil, err
	}

	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ConversationID)
	}
	return ids, nil
}

func conversationRecordToResponse(record *core.Record) conversationRecordResponse {
	version := record.GetInt("key_version")
	if version < 1 {
		// Records created before the key_version field landed have a NULL or
		// zero column value. Treat those as the initial generation so the
		// API contract is "always >=1" and the migration backfill stays an
		// implementation detail.
		version = 1
	}
	return conversationRecordResponse{
		ID:             record.Id,
		Created:        record.GetString("created"),
		Updated:        record.GetString("updated"),
		Data:           record.GetString("data"),
		Creator:        record.GetString("creator"),
		ExpiryDuration: record.GetString("expiry_duration"),
		KeyVersion:     version,
	}
}

func messageRecordToResponse(record *core.Record) messageRecordResponse {
	return messageRecordResponse{
		ID:            record.Id,
		Created:       record.GetString("created"),
		Updated:       record.GetString("updated"),
		Data:          record.GetString("data"),
		Conversation:  record.GetString("conversation"),
		ParentMessage: record.GetString("parent_message"),
		Expires:       record.GetString("expires"),
	}
}

func parsePositiveIntOrDefault(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func isValidExpiryDuration(value string) bool {
	switch value {
	case "", "24h", "168h", "2160h", "4320h":
		return true
	default:
		return false
	}
}
