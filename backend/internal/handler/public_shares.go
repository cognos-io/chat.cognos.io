package handler

import (
	"math"
	"net/http"
	"sort"
	"strings"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/participants"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

// publicShareCollectionName is the collection backing public-link sharing.
const publicShareCollectionName = "conversation_public_shares"

// publicShareTokenLength is the length of the random URL token. 32
// alphanumeric chars is ~190 bits of entropy — the token is the only thing
// gating the (still-encrypted) public payload, so it must be unguessable.
const publicShareTokenLength = 32

type createPublicShareRequest struct {
	PublicKey                    string `json:"public_key"`
	WrappedConversationSecretKey string `json:"wrapped_conversation_secret_key"`
	ShareSecret                  string `json:"share_secret"`
}

type createPublicShareResponse struct {
	Token      string `json:"token"`
	KeyVersion int    `json:"key_version"`
}

// participantPublicShareResponse is what an authenticated participant sees: the
// token plus the sealed share_secret they can open with the conversation
// keypair to reconstruct the URL fragment. The wrapped conversation secret is
// deliberately omitted — a participant already has the conversation key the
// normal way and doesn't need the anonymous-reader wrapper.
type participantPublicShareResponse struct {
	Token       string `json:"token"`
	PublicKey   string `json:"public_key"`
	ShareSecret string `json:"share_secret"`
	KeyVersion  int    `json:"key_version"`
}

// publicConversationResponse is the unauthenticated payload. Everything here is
// ciphertext or a public key — the anonymous reader recovers the conversation
// secret client-side using the fragment key, then decrypts data + messages.
type publicConversationResponse struct {
	ConversationID               string `json:"conversation_id"`
	Data                         string `json:"data"`
	ConversationPublicKey        string `json:"conversation_public_key"`
	WrappedConversationSecretKey string `json:"wrapped_conversation_secret_key"`
	KeyVersion                   int    `json:"key_version"`
}

// ConversationPublicShareCreate publishes a public link for the conversation.
// Admin-only, matching participant-add and key-rotation. The client computes
// all the crypto; the server mints the random token and stamps the current
// key generation. There is at most one share row per conversation — re-sharing
// replaces it and mints a fresh token, invalidating any previous link.
func ConversationPublicShareCreate(app core.App) func(e *core.RequestEvent) error {
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

		repo := participants.NewPocketBaseRepo(app)
		callerRole, _, err := repo.ActiveRole(conversationID, caller.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify caller role", err)
		}
		if callerRole != participants.RoleAdmin {
			return apis.NewForbiddenError("Only conversation admins can share publicly", nil)
		}

		var req createPublicShareRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		req.PublicKey = strings.TrimSpace(req.PublicKey)
		req.WrappedConversationSecretKey = strings.TrimSpace(req.WrappedConversationSecretKey)
		req.ShareSecret = strings.TrimSpace(req.ShareSecret)
		if req.PublicKey == "" || req.WrappedConversationSecretKey == "" || req.ShareSecret == "" {
			return apis.NewBadRequestError(
				"public_key, wrapped_conversation_secret_key and share_secret are required",
				nil,
			)
		}

		collection, err := app.FindCollectionByNameOrId(publicShareCollectionName)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load public shares collection", err)
		}

		keyVersion := currentKeyVersion(conversationRecord)
		token := security.RandomString(publicShareTokenLength)

		// One share row per conversation (UNIQUE index on conversation). Reuse
		// any existing row so re-sharing swaps in the new token + blobs and the
		// previous link dies.
		record, _ := app.FindFirstRecordByFilter(
			publicShareCollectionName,
			"conversation = {:conversation}",
			dbx.Params{"conversation": conversationID},
		)
		if record == nil {
			record = core.NewRecord(collection)
			record.Set("conversation", conversationID)
		}
		record.Set("token", token)
		record.Set("public_key", req.PublicKey)
		record.Set("wrapped_conversation_secret_key", req.WrappedConversationSecretKey)
		record.Set("share_secret", req.ShareSecret)
		record.Set("key_version", keyVersion)

		if err := app.Save(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to create public share", err)
		}

		return e.JSON(http.StatusCreated, createPublicShareResponse{
			Token:      token,
			KeyVersion: keyVersion,
		})
	}
}

// ConversationPublicShareGet returns the active share for a conversation to any
// active participant, so they can reconstruct the same public URL. 404 when
// there's no share or the caller isn't a participant — the same shape a missing
// conversation returns, so it can't be used to probe.
func ConversationPublicShareGet(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		conversationID := e.Request.PathValue("conversationID")
		if _, err := ownedConversationRecord(app, e, conversationID); err != nil {
			return err
		}

		record, err := app.FindFirstRecordByFilter(
			publicShareCollectionName,
			"conversation = {:conversation}",
			dbx.Params{"conversation": conversationID},
		)
		if err != nil || record == nil {
			return apis.NewNotFoundError("Conversation is not publicly shared", err)
		}

		return e.JSON(http.StatusOK, participantPublicShareResponse{
			Token:       record.GetString("token"),
			PublicKey:   record.GetString("public_key"),
			ShareSecret: record.GetString("share_secret"),
			KeyVersion:  publicShareKeyVersion(record),
		})
	}
}

// ConversationPublicShareDelete revokes a public link by deleting the share
// row, so the public URL 404s immediately. Admin-only. It does NOT rotate the
// conversation key — the public read endpoint is the only unauthenticated path
// to the ciphertext, so removing the share already cuts off all future public
// access while leaving the owner's own conversation fully readable. Idempotent:
// revoking an unshared conversation is a no-op success.
func ConversationPublicShareDelete(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		if _, err := ownedConversationRecord(app, e, conversationID); err != nil {
			return err
		}

		repo := participants.NewPocketBaseRepo(app)
		callerRole, _, err := repo.ActiveRole(conversationID, caller.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify caller role", err)
		}
		if callerRole != participants.RoleAdmin {
			return apis.NewForbiddenError("Only conversation admins can revoke a public share", nil)
		}

		if err := deleteConversationPublicShare(app, conversationID); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to revoke public share", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}

// PublicConversationGet is the unauthenticated entry point. Given a share
// token, it returns the encrypted conversation data plus the conversation
// public key and the wrapped conversation secret the anonymous reader needs.
// 404 when the token is unknown or the share was revoked.
func PublicConversationGet(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		share, conversation, err := publicShareByToken(app, e.Request.PathValue("token"))
		if err != nil {
			return err
		}

		keyVersion := publicShareKeyVersion(share)
		publicKey, err := conversationPublicKeyAtVersion(app, conversation.Id, keyVersion)
		if err != nil {
			return apis.NewNotFoundError("Conversation is not publicly shared", err)
		}

		return e.JSON(http.StatusOK, publicConversationResponse{
			ConversationID:               conversation.Id,
			Data:                         conversation.GetString("data"),
			ConversationPublicKey:        publicKey,
			WrappedConversationSecretKey: share.GetString("wrapped_conversation_secret_key"),
			KeyVersion:                   keyVersion,
		})
	}
}

// PublicConversationMessagesList returns the encrypted message blobs for a
// publicly-shared conversation. Same 404 contract as PublicConversationGet.
func PublicConversationMessagesList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		_, conversation, err := publicShareByToken(app, e.Request.PathValue("token"))
		if err != nil {
			return err
		}

		page := parsePositiveIntOrDefault(e.Request.URL.Query().Get("page"), 1)
		perPage := parsePositiveIntOrDefault(e.Request.URL.Query().Get("page_size"), 100)
		if perPage > 100 {
			perPage = 100
		}
		offset := (page - 1) * perPage

		records, err := app.FindAllRecords("messages", dbx.HashExp{"conversation": conversation.Id})
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list messages", err)
		}
		sort.Slice(records, func(i, j int) bool {
			return records[i].GetString("created") > records[j].GetString("created")
		})

		totalItems := len(records)
		start := offset
		if start > totalItems {
			start = totalItems
		}
		end := offset + perPage
		if end > totalItems {
			end = totalItems
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
			TotalItems: int64(totalItems),
			TotalPages: totalPages,
			Items:      items,
		})
	}
}

// publicShareByToken resolves a share token to its share record and the
// conversation it points at, returning a uniform 404 for any miss so the
// endpoint never reveals whether a token once existed.
func publicShareByToken(app core.App, rawToken string) (*core.Record, *core.Record, error) {
	token := strings.TrimSpace(rawToken)
	if token == "" {
		return nil, nil, apis.NewNotFoundError("Public conversation not found", nil)
	}

	share, err := app.FindFirstRecordByFilter(
		publicShareCollectionName,
		"token = {:token}",
		dbx.Params{"token": token},
	)
	if err != nil || share == nil {
		return nil, nil, apis.NewNotFoundError("Public conversation not found", err)
	}

	conversation, err := app.FindRecordById("conversations", share.GetString("conversation"))
	if err != nil {
		return nil, nil, apis.NewNotFoundError("Public conversation not found", err)
	}

	return share, conversation, nil
}

// conversationPublicKeyAtVersion returns the base64 conversation public key for
// a specific generation, or an error if none exists.
func conversationPublicKeyAtVersion(app core.App, conversationID string, keyVersion int) (string, error) {
	records, err := app.FindRecordsByFilter(
		"conversation_public_keys",
		"conversation = {:conversation_id} && key_version = {:key_version}",
		"",
		1,
		0,
		dbx.Params{"conversation_id": conversationID, "key_version": keyVersion},
	)
	if err != nil {
		return "", err
	}
	if len(records) == 0 {
		return "", apis.NewNotFoundError("Conversation public key not found", nil)
	}
	return records[0].GetString("public_key"), nil
}

func publicShareKeyVersion(record *core.Record) int {
	v := record.GetInt("key_version")
	if v < 1 {
		return 1
	}
	return v
}

// deleteConversationPublicShare removes any public share row for a
// conversation. Called from inside the rotation transaction so a key rotation
// always tears down the public link in the same atomic step — the share can
// never outlive the key generation it was issued against.
func deleteConversationPublicShare(txApp core.App, conversationID string) error {
	record, err := txApp.FindFirstRecordByFilter(
		publicShareCollectionName,
		"conversation = {:conversation}",
		dbx.Params{"conversation": conversationID},
	)
	if err != nil || record == nil {
		// No active share is the common case — treat absence as success.
		return nil
	}
	return txApp.Delete(record)
}
