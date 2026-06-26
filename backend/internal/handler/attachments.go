package handler

import (
	"log/slog"
	"net/http"
	"slices"
	"strings"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Attachment storage limits. These bound abuse and keep a single record's
// ciphertext small; the user-facing 10 MiB original cap is enforced client-side,
// while the backend caps the ciphertext it actually receives.
const (
	// DefaultAttachmentMaxFileBytes is the per-artifact ciphertext cap. It allows
	// a ~10 MiB original plus secretbox overhead.
	DefaultAttachmentMaxFileBytes = int64(11 << 20)
	// DefaultAttachmentStorageCapBytes is the per-user total ciphertext cap
	// across conversation_attachments (spec §0). Counts originals + derived.
	DefaultAttachmentStorageCapBytes = int64(1 << 30)
	// MaxAttachmentFilesPerRecord bounds the number of artifacts (original +
	// derived) in one logical attachment.
	MaxAttachmentFilesPerRecord = 16
	// MaxAttachmentsPerMessage bounds how many attachments a single user message
	// may reference (spec §15).
	MaxAttachmentsPerMessage = 4
)

// AttachmentHandlerParams carries the dependencies for the conversation
// attachment routes. The collection is locked to custom routes, so all access
// is authorised here by conversation participant membership.
type AttachmentHandlerParams struct {
	App    core.App
	Logger *slog.Logger
	// MaxFileBytes / StorageCapBytes are 0 to use the defaults above; non-zero
	// only in tests that inject tiny caps.
	MaxFileBytes    int64
	StorageCapBytes int64
}

func (p AttachmentHandlerParams) maxFileBytes() int64 {
	if p.MaxFileBytes > 0 {
		return p.MaxFileBytes
	}
	return DefaultAttachmentMaxFileBytes
}

func (p AttachmentHandlerParams) storageCapBytes() int64 {
	if p.StorageCapBytes > 0 {
		return p.StorageCapBytes
	}
	return DefaultAttachmentStorageCapBytes
}

// attachmentResponse is the transport DTO. Plaintext routing/accounting fields
// only — the manifest stays opaque base64 ciphertext in `data`.
type attachmentResponse struct {
	ID           string   `json:"id"`
	Conversation string   `json:"conversation"`
	Message      string   `json:"message,omitempty"`
	SizeBytes    int64    `json:"size_bytes"`
	Files        []string `json:"files"`
	Data         string   `json:"data"`
	Created      string   `json:"created"`
	Updated      string   `json:"updated"`
}

func newAttachmentResponse(record *core.Record) attachmentResponse {
	return attachmentResponse{
		ID:           record.Id,
		Conversation: record.GetString("conversation"),
		Message:      record.GetString("message"),
		SizeBytes:    int64(record.GetInt("size_bytes")),
		Files:        record.GetStringSlice("files"),
		Data:         record.GetString("data"),
		Created:      record.GetString("created"),
		Updated:      record.GetString("updated"),
	}
}

// AttachmentCreate handles POST /api/v1/conversations/{id}/attachments. It
// accepts a multipart body of a base64 sealed manifest (`data`) plus one or more
// encrypted artifact blobs (`files`), and stores them as a draft attachment
// (no message link yet). All bytes are ciphertext; the server never inspects or
// decrypts them.
func AttachmentCreate(params AttachmentHandlerParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		if conversationID == "" {
			return apis.NewBadRequestError("Conversation ID is required", nil)
		}

		active, err := conversationAccessibleByID(params.App, conversationID, owner.ID)
		if err != nil {
			params.Logger.Error("attachment access lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify access", err)
		}
		if !active {
			// Same 404 a non-existent conversation gives, so the id is not leaked.
			return apis.NewNotFoundError("Conversation not found", nil)
		}

		files, err := e.FindUploadedFiles("files")
		if err != nil || len(files) == 0 {
			return apis.NewBadRequestError("At least one file is required", nil)
		}
		if len(files) > MaxAttachmentFilesPerRecord {
			return apis.NewBadRequestError("Too many files in one attachment", nil)
		}

		data := strings.TrimSpace(e.Request.FormValue("data"))
		if data == "" {
			return apis.NewBadRequestError("Manifest data is required", nil)
		}

		maxFile := params.maxFileBytes()
		var total int64
		for _, f := range files {
			if f.Size > maxFile {
				return apis.NewBadRequestError("Attachment is too large", nil)
			}
			total += f.Size
		}

		used, err := sumOwnerAttachmentBytes(params.App, owner.ID)
		if err != nil {
			params.Logger.Error("attachment storage usage lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify storage usage", err)
		}
		if used+total > params.storageCapBytes() {
			return apis.NewForbiddenError("Storage limit reached", nil)
		}

		collection, err := params.App.FindCollectionByNameOrId("conversation_attachments")
		if err != nil {
			params.Logger.Error("attachment collection lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to store attachment", err)
		}

		record := core.NewRecord(collection)
		record.Set("conversation", conversationID)
		record.Set("owner", owner.ID)
		record.Set("data", data)
		record.Set("files", files)
		record.Set("size_bytes", total)

		if err := params.App.Save(record); err != nil {
			params.Logger.Error("attachment save failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to store attachment", err)
		}

		return e.JSON(http.StatusOK, newAttachmentResponse(record))
	}
}

// AttachmentList handles GET /api/v1/conversations/{id}/attachments and returns
// every attachment record the caller can access for the conversation, so the
// client can resolve message references and reload/export.
func AttachmentList(params AttachmentHandlerParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		if conversationID == "" {
			return apis.NewBadRequestError("Conversation ID is required", nil)
		}

		active, err := conversationAccessibleByID(params.App, conversationID, owner.ID)
		if err != nil {
			params.Logger.Error("attachment access lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify access", err)
		}
		if !active {
			return apis.NewNotFoundError("Conversation not found", nil)
		}

		records, err := params.App.FindRecordsByFilter(
			"conversation_attachments",
			"conversation={:conversation}",
			"created",
			500,
			0,
			dbx.Params{"conversation": conversationID},
		)
		if err != nil {
			params.Logger.Error("attachment list failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list attachments", err)
		}

		out := make([]attachmentResponse, 0, len(records))
		for _, record := range records {
			out = append(out, newAttachmentResponse(record))
		}
		return e.JSON(http.StatusOK, out)
	}
}

// AttachmentDownload handles
// GET /api/v1/conversations/{id}/attachments/{attachmentID}/files/{fileName}.
// It serves the ciphertext bytes of one artifact via the protected-file path,
// gated by the same conversation participant check as the rest of the API. The
// client decrypts using the artifact key from the decrypted manifest.
func AttachmentDownload(params AttachmentHandlerParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		attachmentID := e.Request.PathValue("attachmentID")
		fileName := e.Request.PathValue("fileName")
		if conversationID == "" || attachmentID == "" || fileName == "" {
			return apis.NewBadRequestError("Conversation, attachment and file are required", nil)
		}

		active, err := conversationAccessibleByID(params.App, conversationID, owner.ID)
		if err != nil {
			params.Logger.Error("attachment access lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify access", err)
		}
		if !active {
			return apis.NewNotFoundError("Attachment not found", nil)
		}

		record, err := params.App.FindRecordById("conversation_attachments", attachmentID)
		if err != nil || record.GetString("conversation") != conversationID {
			return apis.NewNotFoundError("Attachment not found", nil)
		}
		if !slices.Contains(record.GetStringSlice("files"), fileName) {
			return apis.NewNotFoundError("Attachment not found", nil)
		}

		fsys, err := params.App.NewFilesystem()
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to open file storage", err)
		}
		defer func() { _ = fsys.Close() }()

		return fsys.Serve(e.Response, e.Request, record.BaseFilesPath()+"/"+fileName, fileName)
	}
}

// AttachmentDelete handles
// DELETE /api/v1/conversations/{id}/attachments/{attachmentID}. V1 allows
// deleting only draft attachments (not yet linked to a message); linked
// attachments are removed when their owning message is deleted/expired.
func AttachmentDelete(params AttachmentHandlerParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		attachmentID := e.Request.PathValue("attachmentID")
		if conversationID == "" || attachmentID == "" {
			return apis.NewBadRequestError("Conversation and attachment are required", nil)
		}

		active, err := conversationAccessibleByID(params.App, conversationID, owner.ID)
		if err != nil {
			params.Logger.Error("attachment access lookup failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify access", err)
		}
		if !active {
			return apis.NewNotFoundError("Attachment not found", nil)
		}

		record, err := params.App.FindRecordById("conversation_attachments", attachmentID)
		if err != nil || record.GetString("conversation") != conversationID {
			return apis.NewNotFoundError("Attachment not found", nil)
		}
		if record.GetString("message") != "" {
			return apis.NewBadRequestError("Attachment is linked to a message", nil)
		}

		if err := params.App.Delete(record); err != nil {
			params.Logger.Error("attachment delete failed", "err", err)
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete attachment", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}

// sumOwnerAttachmentBytes returns the total stored ciphertext bytes for a user
// across all conversation_attachments, for the per-user storage cap.
func sumOwnerAttachmentBytes(app core.App, ownerID string) (int64, error) {
	var res struct {
		Total int64 `db:"total"`
	}
	err := app.DB().
		Select("COALESCE(SUM(size_bytes), 0) AS total").
		From("conversation_attachments").
		Where(dbx.HashExp{"owner": ownerID}).
		One(&res)
	if err != nil {
		return 0, err
	}
	return res.Total, nil
}
