package handler

import (
	"net/http"
	"strings"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Redaction handlers back the browser PII-redaction feature
// (docs/specs/pii-redaction.md). The server only ever holds the redaction
// public key, per-user wrapped redaction secret keys, and sealed token→original
// mappings — never a plaintext sensitive value. Access is gated by active
// conversation participation (the same membership check that gates sending a
// message), so writes are available to anyone who can send, and reads to anyone
// who can view.

const (
	redactionKeysCollectionName    = "conversation_redaction_keys"
	redactionEntriesCollectionName = "redaction_entries"
)

var validRedactionSourceKinds = map[string]bool{
	"message":        true,
	"document":       true,
	"document_chunk": true,
}

type redactionKeyResponse struct {
	PublicKey        string `json:"public_key"`
	WrappedSecretKey string `json:"wrapped_secret_key"`
	KeyVersion       int    `json:"key_version"`
}

type redactionKeyEntry struct {
	UserID           string `json:"user_id"`
	WrappedSecretKey string `json:"wrapped_secret_key"`
}

type createRedactionKeyRequest struct {
	PublicKey string              `json:"public_key"`
	Keys      []redactionKeyEntry `json:"keys"`
}

type createRedactionKeyResponse struct {
	KeyVersion int `json:"key_version"`
}

type redactionEntryInput struct {
	Token      string `json:"token"`
	Data       string `json:"data"`
	SourceKind string `json:"source_kind"`
	SourceID   string `json:"source_id"`
}

type createRedactionEntriesRequest struct {
	Entries []redactionEntryInput `json:"entries"`
}

type redactionEntryResponse struct {
	Token      string `json:"token"`
	Data       string `json:"data"`
	KeyVersion int    `json:"key_version"`
	SourceKind string `json:"source_kind"`
	SourceID   string `json:"source_id"`
}

type listRedactionEntriesResponse struct {
	Items []redactionEntryResponse `json:"items"`
}

// ConversationRedactionKeyGet returns the caller's wrapped redaction key for the
// conversation's current generation, plus the redaction public key so the
// client can seal new entries. 404 when the caller is not a participant or no
// redaction key exists yet — the same shape, so it can't be used to probe.
func ConversationRedactionKeyGet(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		conversationRecord, err := ownedConversationRecord(app, e, conversationID)
		if err != nil {
			return err
		}

		keyVersion := currentKeyVersion(conversationRecord)
		record, err := app.FindFirstRecordByFilter(
			redactionKeysCollectionName,
			"conversation = {:conversation} && user = {:user} && key_version = {:version}",
			dbx.Params{"conversation": conversationID, "user": caller.ID, "version": keyVersion},
		)
		if err != nil || record == nil {
			return apis.NewNotFoundError("Redaction key not found", err)
		}

		return e.JSON(http.StatusOK, redactionKeyResponse{
			PublicKey:        record.GetString("public_key"),
			WrappedSecretKey: record.GetString("wrapped_secret_key"),
			KeyVersion:       redactionKeyVersion(record),
		})
	}
}

// ConversationRedactionKeyCreate stores the redaction keypair for a
// conversation: the shared public key and one wrapped secret key per
// participant who gets mapping access. The client does all the crypto. It is
// create-once per generation — if a current-generation key already exists the
// request is a 409 so a racing sender refetches via GET rather than clobbering
// the key and orphaning existing entries.
func ConversationRedactionKeyCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		conversationRecord, err := ownedConversationRecord(app, e, conversationID)
		if err != nil {
			return err
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

		keyVersion := currentKeyVersion(conversationRecord)

		existing, _ := app.FindFirstRecordByFilter(
			redactionKeysCollectionName,
			"conversation = {:conversation} && key_version = {:version}",
			dbx.Params{"conversation": conversationID, "version": keyVersion},
		)
		if existing != nil {
			return apis.NewApiError(http.StatusConflict, "Redaction key already exists for this generation", nil)
		}

		// Every wrapped key must target an active member, and the caller must be
		// able to decrypt their own mappings, so they must be in the set.
		callerIncluded := false
		for i := range req.Keys {
			req.Keys[i].UserID = strings.TrimSpace(req.Keys[i].UserID)
			req.Keys[i].WrappedSecretKey = strings.TrimSpace(req.Keys[i].WrappedSecretKey)
			if req.Keys[i].UserID == "" || req.Keys[i].WrappedSecretKey == "" {
				return apis.NewBadRequestError("each key requires user_id and wrapped_secret_key", nil)
			}
			active, err := conversationAccessibleByID(app, conversationID, req.Keys[i].UserID)
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to verify participant", err)
			}
			if !active {
				return apis.NewBadRequestError("wrapped key targets a non-participant", nil)
			}
			if req.Keys[i].UserID == caller.ID {
				callerIncluded = true
			}
		}
		if !callerIncluded {
			return apis.NewBadRequestError("caller must be included in the wrapped keys", nil)
		}

		collection, err := app.FindCollectionByNameOrId(redactionKeysCollectionName)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load redaction keys collection", err)
		}

		if err := app.RunInTransaction(func(txApp core.App) error {
			for _, k := range req.Keys {
				record := core.NewRecord(collection)
				record.Set("conversation", conversationID)
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

// ConversationRedactionEntriesList returns every sealed token→original mapping
// for the conversation. The client decrypts each `data` blob with its wrapped
// redaction secret key; the server cannot read the originals.
func ConversationRedactionEntriesList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		conversationID := e.Request.PathValue("conversationID")
		if _, err := ownedConversationRecord(app, e, conversationID); err != nil {
			return err
		}

		records, err := app.FindAllRecords(
			redactionEntriesCollectionName,
			dbx.HashExp{"conversation": conversationID},
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

// ConversationRedactionEntriesCreate persists new token→original mappings. It is
// idempotent per token: an existing (conversation, token) row is left untouched
// so retries and concurrent sends converge. Stamped with the current key
// generation.
func ConversationRedactionEntriesCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		conversationRecord, err := ownedConversationRecord(app, e, conversationID)
		if err != nil {
			return err
		}

		var req createRedactionEntriesRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if len(req.Entries) == 0 {
			return apis.NewBadRequestError("at least one entry is required", nil)
		}

		keyVersion := currentKeyVersion(conversationRecord)
		collection, err := app.FindCollectionByNameOrId(redactionEntriesCollectionName)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load redaction entries collection", err)
		}

		for i := range req.Entries {
			req.Entries[i].Token = strings.TrimSpace(req.Entries[i].Token)
			req.Entries[i].Data = strings.TrimSpace(req.Entries[i].Data)
			req.Entries[i].SourceKind = strings.TrimSpace(req.Entries[i].SourceKind)
			req.Entries[i].SourceID = strings.TrimSpace(req.Entries[i].SourceID)
			if req.Entries[i].Token == "" || req.Entries[i].Data == "" {
				return apis.NewBadRequestError("each entry requires token and data", nil)
			}
			if !validRedactionSourceKinds[req.Entries[i].SourceKind] {
				return apis.NewBadRequestError("invalid source_kind", nil)
			}
		}

		created := make([]string, 0, len(req.Entries))
		if err := app.RunInTransaction(func(txApp core.App) error {
			for _, entry := range req.Entries {
				existing, _ := txApp.FindFirstRecordByFilter(
					redactionEntriesCollectionName,
					"conversation = {:conversation} && token = {:token}",
					dbx.Params{"conversation": conversationID, "token": entry.Token},
				)
				if existing != nil {
					continue
				}
				record := core.NewRecord(collection)
				record.Set("conversation", conversationID)
				record.Set("token", entry.Token)
				record.Set("key_version", keyVersion)
				record.Set("data", entry.Data)
				record.Set("source_kind", entry.SourceKind)
				record.Set("source_id", entry.SourceID)
				if err := txApp.Save(record); err != nil {
					return err
				}
				created = append(created, entry.Token)
			}
			return nil
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to store redaction entries", err)
		}

		return e.JSON(http.StatusCreated, map[string]any{"created": created})
	}
}

func redactionEntryToResponse(record *core.Record) redactionEntryResponse {
	return redactionEntryResponse{
		Token:      record.GetString("token"),
		Data:       record.GetString("data"),
		KeyVersion: redactionKeyVersion(record),
		SourceKind: record.GetString("source_kind"),
		SourceID:   record.GetString("source_id"),
	}
}

func redactionKeyVersion(record *core.Record) int {
	v := record.GetInt("key_version")
	if v < 1 {
		return 1
	}
	return v
}
