package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
)

// Bookmarks: a client-encrypted, ciphertext-only store of user-highlighted text
// spans from a message. It mirrors user memory (owner-scoped, opaque ciphertext)
// but additionally links each bookmark to a conversation + message so the client
// can re-anchor the highlight. The server only ever stores opaque ciphertext in
// `data`; the linking ids are plaintext. Create is gated by conversation access
// (the caller must be a participant/member); list and delete are owner-only and
// return a neutral 404 for a foreign record so ids can't be probed.

const bookmarksCollection = "user_bookmarks"

type bookmarkRecordResponse struct {
	ID           string `json:"id"`
	Conversation string `json:"conversation"`
	Message      string `json:"message"`
	Data         string `json:"data"`
	Created      string `json:"created"`
	Updated      string `json:"updated"`
}

type bookmarkWriteRequest struct {
	Conversation string `json:"conversation"`
	Message      string `json:"message"`
	Data         string `json:"data"`
}

type bookmarkListResponse struct {
	Items []bookmarkRecordResponse `json:"items"`
}

func toBookmarkResponse(record *core.Record) bookmarkRecordResponse {
	return bookmarkRecordResponse{
		ID:           record.Id,
		Conversation: record.GetString("conversation"),
		Message:      record.GetString("message"),
		Data:         record.GetString("data"),
		Created:      record.GetDateTime("created").Time().UTC().Format(time.RFC3339),
		Updated:      record.GetDateTime("updated").Time().UTC().Format(time.RFC3339),
	}
}

func toBookmarkList(records []*core.Record) bookmarkListResponse {
	items := make([]bookmarkRecordResponse, 0, len(records))
	for _, record := range records {
		items = append(items, toBookmarkResponse(record))
	}
	return bookmarkListResponse{Items: items}
}

// BookmarkCreate stores a client-encrypted bookmark (sealed to the user's public
// key). The owner is set server-side and the target conversation must be
// accessible by the caller — otherwise the same neutral 404 a missing
// conversation returns, so ids can't be probed.
func BookmarkCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		var req bookmarkWriteRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Invalid request body", err)
		}
		conversationID := strings.TrimSpace(req.Conversation)
		message := strings.TrimSpace(req.Message)
		data := strings.TrimSpace(req.Data)
		if conversationID == "" {
			return apis.NewBadRequestError("Conversation is required", nil)
		}
		if message == "" {
			return apis.NewBadRequestError("Message is required", nil)
		}
		if data == "" {
			return apis.NewBadRequestError("Data is required", nil)
		}

		active, err := conversationAccessibleByID(app, conversationID, user.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify conversation access", err)
		}
		if !active {
			// Same shape a missing conversation returns, so ids can't be probed.
			return apis.NewNotFoundError("Conversation not found", nil)
		}

		collection, err := app.FindCollectionByNameOrId(bookmarksCollection)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load collection", err)
		}
		record := core.NewRecord(collection)
		record.Set("user", user.ID)
		record.Set("conversation", conversationID)
		record.Set("message", message)
		record.Set("data", data)
		if err := app.Save(record); err != nil {
			return apis.NewBadRequestError("Failed to save bookmark", err)
		}
		return e.JSON(http.StatusOK, toBookmarkResponse(record))
	}
}

// BookmarkList returns the authenticated user's bookmarks, optionally filtered
// to a single conversation via ?conversation=.
func BookmarkList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		filter := "user = {:user}"
		params := map[string]any{"user": user.ID}
		if conversationID := strings.TrimSpace(e.Request.URL.Query().Get("conversation")); conversationID != "" {
			filter += " && conversation = {:conversation}"
			params["conversation"] = conversationID
		}

		records, err := app.FindRecordsByFilter(
			bookmarksCollection,
			filter,
			"created",
			0,
			0,
			params,
		)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load bookmarks", err)
		}
		return e.JSON(http.StatusOK, toBookmarkList(records))
	}
}

// BookmarkDelete removes a bookmark (owner only). A foreign or missing record is
// an indistinguishable 404.
func BookmarkDelete(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		record, err := app.FindRecordById(bookmarksCollection, e.Request.PathValue("id"))
		if err != nil || record.GetString("user") != user.ID {
			return apis.NewNotFoundError("Bookmark not found", nil)
		}
		if err := app.Delete(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete bookmark", err)
		}
		return e.NoContent(http.StatusNoContent)
	}
}
