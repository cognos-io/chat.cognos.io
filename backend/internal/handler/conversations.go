package handler

import (
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

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
	// Data, when set, replaces the encrypted message blob. Used for soft-delete:
	// the client re-encrypts a tombstone (role preserved, content removed) and
	// sends the new ciphertext here. The collection's base64 pattern validates it.
	Data string `json:"data,omitempty"`
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
		record.Set("creator", user.ID)
		record.Set("data", req.Data)
		record.Set("expiry_duration", req.ExpiryDuration)
		record.Set("key_version", 1)

		participantsCollection, err := app.FindCollectionByNameOrId(participants.CollectionName)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load participants collection", err)
		}

		// Wrap both writes in a single transaction so we never end up with a
		// stranded conversation row whose creator has no participant entry.
		// Pre-transaction the code tried to compensate by deleting the
		// conversation on failure, but a follow-up delete error would have
		// left orphan state behind. A transactional write removes that case
		// entirely — either both rows land or neither does.
		if err := app.RunInTransaction(func(txApp core.App) error {
			if err := txApp.Save(record); err != nil {
				return err
			}

			participantRecord := core.NewRecord(participantsCollection)
			participantRecord.Set("conversation", record.Id)
			participantRecord.Set("user", user.ID)
			participantRecord.Set("role", string(participants.RoleAdmin))
			participantRecord.Set("added_at", time.Now().UTC())
			return txApp.Save(participantRecord)
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to create conversation", err)
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

type participantResponse struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversation_id"`
	UserID         string `json:"user_id"`
	Role           string `json:"role"`
	AddedAt        string `json:"added_at,omitempty"`
}

type listParticipantsResponse struct {
	Participants []participantResponse `json:"participants"`
}

type createParticipantRequest struct {
	UserID           string `json:"user_id"`
	Role             string `json:"role"`
	WrappedSecretKey string `json:"wrapped_secret_key"`
}

type rotateConversationKeyRequest struct {
	RevokedUserIDs     []string                     `json:"revoked_user_ids,omitempty"`
	PublicKey          string                       `json:"public_key"`
	PublicKeySignature string                       `json:"public_key_signature,omitempty"`
	WrappedSecretKeys  []rotateConversationKeyEntry `json:"wrapped_secret_keys"`
}

type rotateConversationKeyEntry struct {
	UserID    string `json:"user_id"`
	SecretKey string `json:"secret_key"`
}

type rotateConversationKeyResponse struct {
	ConversationID string   `json:"conversation_id"`
	KeyVersion     int      `json:"key_version"`
	RevokedUserIDs []string `json:"revoked_user_ids"`
}

// ConversationParticipantsList returns the currently-active participants for
// a conversation the caller can access. Non-participants get 404 — the same
// shape a missing conversation would return so the response can't be used
// to probe for conversation ids.
func ConversationParticipantsList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		conversationID := e.Request.PathValue("conversationID")
		if _, err := ownedConversationRecord(app, e, conversationID); err != nil {
			return err
		}

		repo := participants.NewPocketBaseRepo(app)
		members, err := repo.ListActive(conversationID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list conversation participants", err)
		}

		out := make([]participantResponse, 0, len(members))
		for _, m := range members {
			out = append(out, participantResponse{
				ID:             m.ID,
				ConversationID: m.ConversationID,
				UserID:         m.UserID,
				Role:           string(m.Role),
				AddedAt:        m.AddedAt,
			})
		}

		return e.JSON(http.StatusOK, listParticipantsResponse{Participants: out})
	}
}

// ConversationParticipantsAdd is the sharing primitive. The caller must
// already be an Admin participant of the conversation. The body carries the
// target user id, the role they should be granted, and the conversation
// secret key wrapped for that user (computed client-side). Both the
// participants row and the wrapped key row are written inside a single
// PocketBase transaction so a partial failure can't leave the target user
// with access but no key (or vice versa).
func ConversationParticipantsAdd(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		conversation, err := ownedConversationRecord(app, e, conversationID)
		if err != nil {
			return err
		}

		repo := participants.NewPocketBaseRepo(app)
		callerRole, _, err := repo.ActiveRole(conversationID, caller.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify caller role", err)
		}
		if callerRole != participants.RoleAdmin {
			// Only Admins can add participants. Anyone else (including
			// editors) gets the same 403 as a flat-out unauthorized
			// caller — exposing the role distinction would leak whether
			// the caller is a member at all.
			return apis.NewForbiddenError("Only conversation admins can add participants", nil)
		}

		var req createParticipantRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		req.UserID = strings.TrimSpace(req.UserID)
		req.Role = strings.TrimSpace(req.Role)
		req.WrappedSecretKey = strings.TrimSpace(req.WrappedSecretKey)

		if req.UserID == "" {
			return apis.NewBadRequestError("user_id is required", nil)
		}
		if req.WrappedSecretKey == "" {
			return apis.NewBadRequestError("wrapped_secret_key is required", nil)
		}
		role, ok := parseParticipantRole(req.Role)
		if !ok {
			return apis.NewBadRequestError("role must be one of Admin/Editor/Viewer", nil)
		}
		if req.UserID == caller.ID {
			return apis.NewBadRequestError("Caller cannot re-add themselves", nil)
		}

		if _, err := app.FindRecordById("users", req.UserID); err != nil {
			return apis.NewNotFoundError("Target user not found", err)
		}

		keyVersion := conversation.GetInt("key_version")
		if keyVersion < 1 {
			keyVersion = 1
		}

		secretKeyCollection, err := app.FindCollectionByNameOrId("conversation_secret_keys")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load conversation secret keys collection", err)
		}
		participantsCollection, err := app.FindCollectionByNameOrId(participants.CollectionName)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load participants collection", err)
		}

		// The participants collection has a UNIQUE(conversation, user)
		// index. A user who was previously revoked still has a row (with
		// removed_at stamped), so a fresh insert would 500. Look up any
		// existing row first:
		//   - active row → reject as duplicate add (400)
		//   - soft-revoked row → re-activate it inside the TX below
		//   - no row → insert fresh
		var participantRecord *core.Record
		existing, _ := app.FindFirstRecordByFilter(
			participants.CollectionName,
			"conversation = {:conversation} && user = {:user}",
			dbx.Params{"conversation": conversationID, "user": req.UserID},
		)
		if existing != nil {
			if existing.GetString("removed_at") == "" {
				return apis.NewBadRequestError("User is already an active participant", nil)
			}
			participantRecord = existing
		} else {
			participantRecord = core.NewRecord(participantsCollection)
			participantRecord.Set("conversation", conversationID)
			participantRecord.Set("user", req.UserID)
		}
		participantRecord.Set("role", string(role))
		participantRecord.Set("added_at", time.Now().UTC())
		participantRecord.Set("removed_at", "")

		secretKeyRecord := core.NewRecord(secretKeyCollection)
		secretKeyRecord.Set("conversation", conversationID)
		secretKeyRecord.Set("user", req.UserID)
		secretKeyRecord.Set("secret_key", req.WrappedSecretKey)
		secretKeyRecord.Set("key_version", keyVersion)

		if err := app.RunInTransaction(func(txApp core.App) error {
			if err := txApp.Save(participantRecord); err != nil {
				return err
			}
			return txApp.Save(secretKeyRecord)
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to add conversation participant", err)
		}

		return e.JSON(http.StatusCreated, participantResponse{
			ID:             participantRecord.Id,
			ConversationID: conversationID,
			UserID:         req.UserID,
			Role:           string(role),
			AddedAt:        participantRecord.GetString("added_at"),
		})
	}
}

// ConversationKeyRotate bumps the conversation's key_version, persists a
// new conversation public key at the new version, and installs a fresh
// per-participant wrapped secret key for every participant who remains
// active after the (optional) revocation step. Caller (Admin) must provide
// a wrapped secret key for EVERY post-revoke active participant; missing
// or extra entries are rejected so the rotation can never leave a
// participant locked out of the new generation.
//
// When revoked_user_ids is non-empty the named users are soft-removed
// inside the same transaction as the rotation. Bundling revoke and rotate
// closes the forward-secrecy gap: there is no observable state where a
// "revoked" participant retains a valid wrapped key for the current
// generation.
func ConversationKeyRotate(app core.App) func(e *core.RequestEvent) error {
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
			return apis.NewForbiddenError("Only conversation admins can rotate the key", nil)
		}

		var req rotateConversationKeyRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		req.PublicKey = strings.TrimSpace(req.PublicKey)
		if req.PublicKey == "" {
			return apis.NewBadRequestError("public_key is required", nil)
		}
		if len(req.WrappedSecretKeys) == 0 {
			return apis.NewBadRequestError("wrapped_secret_keys is required", nil)
		}

		// Normalise revoked_user_ids and reject local-only problems
		// (duplicates, self-revoke) before touching the DB.
		revoked := make(map[string]struct{}, len(req.RevokedUserIDs))
		revokedOrdered := make([]string, 0, len(req.RevokedUserIDs))
		for _, raw := range req.RevokedUserIDs {
			userID := strings.TrimSpace(raw)
			if userID == "" {
				return apis.NewBadRequestError("revoked_user_ids contains an empty user_id", nil)
			}
			if userID == caller.ID {
				return apis.NewBadRequestError("Caller cannot revoke themselves", nil)
			}
			if _, dup := revoked[userID]; dup {
				return apis.NewBadRequestError("revoked_user_ids contains a duplicate user_id", nil)
			}
			revoked[userID] = struct{}{}
			revokedOrdered = append(revokedOrdered, userID)
		}

		members, err := repo.ListActive(conversationID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to enumerate conversation participants", err)
		}

		// Active set today; expected set post-revoke = active − revoked.
		active := make(map[string]struct{}, len(members))
		for _, m := range members {
			active[m.UserID] = struct{}{}
		}
		for _, userID := range revokedOrdered {
			if _, ok := active[userID]; !ok {
				return apis.NewNotFoundError("Participant to revoke is not active", nil)
			}
		}
		expected := make(map[string]struct{}, len(members))
		for userID := range active {
			if _, isRevoked := revoked[userID]; isRevoked {
				continue
			}
			expected[userID] = struct{}{}
		}

		seen := make(map[string]string, len(req.WrappedSecretKeys))
		for _, entry := range req.WrappedSecretKeys {
			userID := strings.TrimSpace(entry.UserID)
			secret := strings.TrimSpace(entry.SecretKey)
			if userID == "" || secret == "" {
				return apis.NewBadRequestError("Each wrapped_secret_keys entry needs a non-empty user_id and secret_key", nil)
			}
			if _, isRevoked := revoked[userID]; isRevoked {
				return apis.NewBadRequestError("wrapped_secret_keys entry targets a user being revoked", nil)
			}
			if _, ok := expected[userID]; !ok {
				return apis.NewBadRequestError("wrapped_secret_keys entry targets a non-participant", nil)
			}
			if _, dup := seen[userID]; dup {
				return apis.NewBadRequestError("wrapped_secret_keys contains a duplicate user_id", nil)
			}
			seen[userID] = secret
		}
		if len(seen) != len(expected) {
			return apis.NewBadRequestError("wrapped_secret_keys must cover every active participant", nil)
		}

		newVersion := conversationRecord.GetInt("key_version")
		if newVersion < 1 {
			newVersion = 1
		}
		newVersion++

		publicKeysCollection, err := app.FindCollectionByNameOrId("conversation_public_keys")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load conversation public keys collection", err)
		}
		secretKeysCollection, err := app.FindCollectionByNameOrId("conversation_secret_keys")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load conversation secret keys collection", err)
		}

		if err := app.RunInTransaction(func(txApp core.App) error {
			// Soft-revoke first, inside the same TX as the rotation so an
			// outside observer never sees the half-revoked state.
			txRepo := participants.NewPocketBaseRepo(txApp)
			for _, userID := range revokedOrdered {
				if err := txRepo.Revoke(conversationID, userID); err != nil {
					return err
				}
			}

			conversationRecord.Set("key_version", newVersion)
			if err := txApp.Save(conversationRecord); err != nil {
				return err
			}

			// A rotation always invalidates any public link: the new
			// generation's messages are sealed to a key the old public-share
			// wrapper can't reach, so the link would silently stop working.
			// Delete it here so the public URL 404s cleanly and the revoke
			// semantics ("stop sharing" rotates) hold in one transaction.
			if err := deleteConversationPublicShare(txApp, conversationID); err != nil {
				return err
			}

			pubRecord := core.NewRecord(publicKeysCollection)
			pubRecord.Set("conversation", conversationID)
			pubRecord.Set("public_key", req.PublicKey)
			pubRecord.Set("public_key_signature", req.PublicKeySignature)
			pubRecord.Set("key_version", newVersion)
			if err := txApp.Save(pubRecord); err != nil {
				return err
			}

			for userID, secret := range seen {
				secretRecord := core.NewRecord(secretKeysCollection)
				secretRecord.Set("conversation", conversationID)
				secretRecord.Set("user", userID)
				secretRecord.Set("secret_key", secret)
				secretRecord.Set("key_version", newVersion)
				if err := txApp.Save(secretRecord); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to rotate conversation key", err)
		}

		return e.JSON(http.StatusOK, rotateConversationKeyResponse{
			ConversationID: conversationID,
			KeyVersion:     newVersion,
			RevokedUserIDs: revokedOrdered,
		})
	}
}

func parseParticipantRole(raw string) (participants.Role, bool) {
	switch raw {
	case string(participants.RoleAdmin), string(participants.RoleEditor), string(participants.RoleViewer):
		return participants.Role(raw), true
	default:
		return "", false
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
		req.Data = strings.TrimSpace(req.Data)
		if !req.ClearExpires && req.Data == "" {
			return apis.NewBadRequestError("clear_expires or data is required", nil)
		}

		update := map[string]any{}
		if req.ClearExpires {
			update["expires"] = nil
		}
		if req.Data != "" {
			update["data"] = req.Data
		}

		form := forms.NewRecordUpsert(app, record)
		form.Load(update)
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
