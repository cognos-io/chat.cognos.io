package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/participants"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Conversation copy ("Duplicate chat"). A duplicate is a brand-new conversation
// with a FRESH keypair, so the source ciphertext is useless to it. The browser
// decrypts every source message, rewrites its conversation/parent bindings,
// re-seals each payload to the duplicate public key, and ships the whole
// ciphertext bundle here. The backend never sees plaintext: it validates the
// message graph against the authoritative source rows, then writes the
// conversation, keys, participant, messages, and (optional) redaction map in a
// single transaction — all or nothing (docs/business_processes/conversation-copy.md).
//
// v1 scope (§0.0): standalone conversations only; PII redaction copied;
// attachments and project sources fail closed. Larger work (projects,
// attachment re-seal, multi-attachment, signature enforcement, background-job
// copy for oversized conversations) is deferred and tracked in the spec.

// maxCopyMessages caps the synchronous, single-transaction copy. Oversized
// sources fail closed; the escalation path is a background job (§13).
const maxCopyMessages = 500

type copyConversationInput struct {
	ID                 string `json:"id"`
	Data               string `json:"data"`
	PublicKey          string `json:"public_key"`
	PublicKeySignature string `json:"public_key_signature"`
	WrappedSecretKey   string `json:"wrapped_secret_key"`
	ExpiryDuration     string `json:"expiry_duration,omitempty"`
}

type copyMessageInput struct {
	ID       string `json:"id"`
	SourceID string `json:"source_id"`
	Data     string `json:"data"`
}

type copyRedactionEntryInput struct {
	Token      string `json:"token"`
	Data       string `json:"data"`
	SourceKind string `json:"source_kind"`
	SourceID   string `json:"source_id"`
}

type copyRedactionInput struct {
	PublicKey        string                    `json:"public_key"`
	WrappedSecretKey string                    `json:"wrapped_secret_key"`
	Entries          []copyRedactionEntryInput `json:"entries"`
}

type copyConversationRequest struct {
	Conversation copyConversationInput `json:"conversation"`
	Messages     []copyMessageInput    `json:"messages"`
	Redaction    *copyRedactionInput   `json:"redaction,omitempty"`
}

type copyConversationResponse struct {
	Conversation conversationRecordResponse `json:"conversation"`
	MessageCount int                        `json:"message_count"`
}

// ConversationCopy duplicates a standalone conversation from a client-prepared
// ciphertext bundle. POST /api/v1/conversations/{conversationID}/copies.
func ConversationCopy(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		sourceID := e.Request.PathValue("conversationID")
		// Read access is the duplicate gate for standalone conversations: a
		// non-participant gets the same 404 as a missing conversation.
		sourceRecord, err := ownedConversationRecord(app, e, sourceID)
		if err != nil {
			return err
		}

		// v1: project conversations are out of scope and fail closed rather than
		// silently producing a standalone copy that drops project access.
		if sourceRecord.GetString("project") != "" {
			return apis.NewBadRequestError("Project conversations cannot be duplicated yet", nil)
		}

		var req copyConversationRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		if err := validateCopyConversationInput(req.Conversation); err != nil {
			return err
		}

		// Load the authoritative source message rows. The backend — never the
		// client — decides the true message set and parent links.
		sourceMessages, err := app.FindAllRecords(
			"messages",
			dbx.HashExp{"conversation": sourceID},
		)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load source messages", err)
		}
		if len(sourceMessages) > maxCopyMessages {
			return apis.NewBadRequestError("Conversation is too large to duplicate", nil)
		}

		// v1: attachments fail closed — re-sealing attachment keys is deferred.
		for _, m := range sourceMessages {
			if m.GetString("attachment") != "" {
				return apis.NewBadRequestError("Conversations with attachments cannot be duplicated yet", nil)
			}
		}

		metas, sourceParents := sourceMessageGraph(sourceMessages)
		idMap, err := buildCopyIDMap(metas, req.Messages)
		if err != nil {
			return err
		}

		if err := validateCopyRedaction(req.Redaction, idMap); err != nil {
			return err
		}

		// Deterministic conflict check: any submitted id that already exists is a
		// 409 and we write nothing. The client must regenerate the whole bundle
		// (encrypted parent pointers are baked in, so a single-id patch is unsafe).
		if recordExists(app, "conversations", req.Conversation.ID) {
			return apis.NewApiError(http.StatusConflict, "Duplicate conversation id already exists", nil)
		}
		for _, m := range req.Messages {
			if recordExists(app, "messages", m.ID) {
				return apis.NewApiError(http.StatusConflict, "Duplicate message id already exists", nil)
			}
		}

		expires := copyMessageExpiry(req.Conversation.ExpiryDuration)

		conversationRecord, err := writeCopy(app, caller.ID, req, sourceParents, idMap, expires)
		if err != nil {
			return err
		}

		return e.JSON(http.StatusCreated, copyConversationResponse{
			Conversation: conversationRecordToResponse(conversationRecord),
			MessageCount: len(req.Messages),
		})
	}
}

func validateCopyConversationInput(c copyConversationInput) error {
	if strings.TrimSpace(c.ID) == "" {
		return apis.NewBadRequestError("conversation.id is required", nil)
	}
	if strings.TrimSpace(c.Data) == "" {
		return apis.NewBadRequestError("conversation.data is required", nil)
	}
	if strings.TrimSpace(c.PublicKey) == "" {
		return apis.NewBadRequestError("conversation.public_key is required", nil)
	}
	if strings.TrimSpace(c.PublicKeySignature) == "" {
		return apis.NewBadRequestError("conversation.public_key_signature is required", nil)
	}
	// Standalone duplicates carry the conversation secret wrapped for the caller.
	if strings.TrimSpace(c.WrappedSecretKey) == "" {
		return apis.NewBadRequestError("conversation.wrapped_secret_key is required", nil)
	}
	if !isValidExpiryDuration(c.ExpiryDuration) {
		return apis.NewBadRequestError("Invalid expiry duration", nil)
	}
	return nil
}

// sourceMessageMeta is the minimal view of a source message the graph validator
// needs. Keeping the validator off *core.Record makes it pure and unit-testable.
type sourceMessageMeta struct {
	id     string
	parent string
}

// sourceMessageGraph projects the source rows into the validator's view plus a
// source-id → parent-id lookup used when remapping parents during the write.
func sourceMessageGraph(sourceMessages []*core.Record) ([]sourceMessageMeta, map[string]string) {
	metas := make([]sourceMessageMeta, 0, len(sourceMessages))
	parents := make(map[string]string, len(sourceMessages))
	for _, m := range sourceMessages {
		parent := m.GetString("parent_message")
		metas = append(metas, sourceMessageMeta{id: m.Id, parent: parent})
		parents[m.Id] = parent
	}
	return metas, parents
}

// buildCopyIDMap validates the submitted message bundle against the source rows
// and returns a source-id → duplicate-id map. It rejects foreign, missing,
// duplicate, and malformed entries so the backend — not the client — guarantees
// the duplicate tree mirrors the source exactly.
func buildCopyIDMap(
	source []sourceMessageMeta,
	submitted []copyMessageInput,
) (map[string]string, error) {
	if len(submitted) != len(source) {
		return nil, apis.NewBadRequestError(
			"message count does not match the source conversation", nil)
	}

	sourceByID := make(map[string]bool, len(source))
	for _, m := range source {
		sourceByID[m.id] = true
	}

	idMap := make(map[string]string, len(submitted))
	seenSource := make(map[string]bool, len(submitted))
	seenDup := make(map[string]bool, len(submitted))

	for _, m := range submitted {
		sourceMsgID := strings.TrimSpace(m.SourceID)
		dupID := strings.TrimSpace(m.ID)
		if sourceMsgID == "" || dupID == "" {
			return nil, apis.NewBadRequestError("each message requires id and source_id", nil)
		}
		if strings.TrimSpace(m.Data) == "" {
			return nil, apis.NewBadRequestError("each message requires data", nil)
		}
		if !sourceByID[sourceMsgID] {
			return nil, apis.NewBadRequestError("source_id is not in the source conversation", nil)
		}
		if seenSource[sourceMsgID] {
			return nil, apis.NewBadRequestError("duplicate source_id in request", nil)
		}
		if seenDup[dupID] {
			return nil, apis.NewBadRequestError("duplicate message id in request", nil)
		}
		seenSource[sourceMsgID] = true
		seenDup[dupID] = true
		idMap[sourceMsgID] = dupID
	}

	// Every source parent must be inside the copied set, so no duplicate message
	// is orphaned. (Same-conversation parents always are, but a corrupt source
	// row would otherwise slip through.)
	for _, m := range source {
		if m.parent != "" {
			if _, ok := idMap[m.parent]; !ok {
				return nil, apis.NewBadRequestError("a source message parent is outside the copied set", nil)
			}
		}
	}

	return idMap, nil
}

func validateCopyRedaction(r *copyRedactionInput, idMap map[string]string) error {
	if r == nil {
		return nil
	}
	if strings.TrimSpace(r.PublicKey) == "" {
		return apis.NewBadRequestError("redaction.public_key is required", nil)
	}
	if strings.TrimSpace(r.WrappedSecretKey) == "" {
		return apis.NewBadRequestError("redaction.wrapped_secret_key is required", nil)
	}
	for _, entry := range r.Entries {
		if strings.TrimSpace(entry.Token) == "" || strings.TrimSpace(entry.Data) == "" {
			return apis.NewBadRequestError("each redaction entry requires token and data", nil)
		}
		if !validRedactionSourceKinds[entry.SourceKind] {
			return apis.NewBadRequestError("invalid redaction source_kind", nil)
		}
		// Message-anchored entries must already point at a copied duplicate
		// message id, proving the client remapped source_id before sending.
		if entry.SourceKind == "message" {
			if !idMapContainsValue(idMap, strings.TrimSpace(entry.SourceID)) {
				return apis.NewBadRequestError("redaction entry source_id must reference a copied message", nil)
			}
		}
	}
	return nil
}

// writeCopy performs the all-or-nothing write: conversation, admin participant,
// public key, wrapped secret key, messages with remapped parents, and the
// optional redaction key + entries.
func writeCopy(
	app core.App,
	callerID string,
	req copyConversationRequest,
	sourceParents map[string]string,
	idMap map[string]string,
	expires time.Time,
) (*core.Record, error) {
	collections, err := loadCopyCollections(app, req.Redaction != nil)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	conversationRecord := core.NewRecord(collections.conversations)
	conversationRecord.Id = req.Conversation.ID

	txErr := app.RunInTransaction(func(txApp core.App) error {
		conversationRecord.Set("creator", callerID)
		conversationRecord.Set("data", req.Conversation.Data)
		conversationRecord.Set("expiry_duration", req.Conversation.ExpiryDuration)
		conversationRecord.Set("key_version", 1)
		conversationRecord.Set("last_activity_at", now)
		if err := txApp.Save(conversationRecord); err != nil {
			return err
		}

		participantRecord := core.NewRecord(collections.participants)
		participantRecord.Set("conversation", conversationRecord.Id)
		participantRecord.Set("user", callerID)
		participantRecord.Set("role", string(participants.RoleAdmin))
		participantRecord.Set("added_at", now)
		if err := txApp.Save(participantRecord); err != nil {
			return err
		}

		publicKeyRecord := core.NewRecord(collections.publicKeys)
		publicKeyRecord.Set("conversation", conversationRecord.Id)
		publicKeyRecord.Set("public_key", req.Conversation.PublicKey)
		publicKeyRecord.Set("public_key_signature", req.Conversation.PublicKeySignature)
		publicKeyRecord.Set("key_version", 1)
		if err := txApp.Save(publicKeyRecord); err != nil {
			return err
		}

		secretKeyRecord := core.NewRecord(collections.secretKeys)
		secretKeyRecord.Set("conversation", conversationRecord.Id)
		secretKeyRecord.Set("user", callerID)
		secretKeyRecord.Set("secret_key", req.Conversation.WrappedSecretKey)
		secretKeyRecord.Set("key_version", 1)
		if err := txApp.Save(secretKeyRecord); err != nil {
			return err
		}

		for _, m := range req.Messages {
			dupParent := ""
			if parent := sourceParents[strings.TrimSpace(m.SourceID)]; parent != "" {
				dupParent = idMap[parent]
			}

			messageRecord := core.NewRecord(collections.messages)
			messageRecord.Id = strings.TrimSpace(m.ID)
			messageRecord.Set("conversation", conversationRecord.Id)
			messageRecord.Set("parent_message", dupParent)
			messageRecord.Set("data", m.Data)
			if !expires.IsZero() {
				messageRecord.Set("expires", expires)
			}
			if err := txApp.Save(messageRecord); err != nil {
				return err
			}
		}

		if req.Redaction != nil {
			redactionKeyRecord := core.NewRecord(collections.redactionKeys)
			redactionKeyRecord.Set("conversation", conversationRecord.Id)
			redactionKeyRecord.Set("user", callerID)
			redactionKeyRecord.Set("key_version", 1)
			redactionKeyRecord.Set("public_key", req.Redaction.PublicKey)
			redactionKeyRecord.Set("wrapped_secret_key", req.Redaction.WrappedSecretKey)
			if err := txApp.Save(redactionKeyRecord); err != nil {
				return err
			}

			for _, entry := range req.Redaction.Entries {
				entryRecord := core.NewRecord(collections.redactionEntries)
				entryRecord.Set("conversation", conversationRecord.Id)
				entryRecord.Set("token", strings.TrimSpace(entry.Token))
				entryRecord.Set("key_version", 1)
				entryRecord.Set("data", entry.Data)
				entryRecord.Set("source_kind", entry.SourceKind)
				entryRecord.Set("source_id", strings.TrimSpace(entry.SourceID))
				if err := txApp.Save(entryRecord); err != nil {
					return err
				}
			}
		}

		return nil
	})
	if txErr != nil {
		// Most failures here are validation (malformed id/base64); a racing id
		// collision is the rare exception. Surface a 400 — the deterministic 409
		// path already ran, and either way the transaction rolled back cleanly.
		return nil, apis.NewBadRequestError("Failed to duplicate conversation", txErr)
	}

	return conversationRecord, nil
}

type copyCollections struct {
	conversations    *core.Collection
	participants     *core.Collection
	publicKeys       *core.Collection
	secretKeys       *core.Collection
	messages         *core.Collection
	redactionKeys    *core.Collection
	redactionEntries *core.Collection
}

func loadCopyCollections(app core.App, withRedaction bool) (*copyCollections, error) {
	names := []string{
		"conversations",
		participants.CollectionName,
		"conversation_public_keys",
		"conversation_secret_keys",
		"messages",
	}
	if withRedaction {
		names = append(names, redactionKeysCollectionName, redactionEntriesCollectionName)
	}

	loaded := make(map[string]*core.Collection, len(names))
	for _, name := range names {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return nil, apis.NewApiError(http.StatusInternalServerError, "Failed to load collection", err)
		}
		loaded[name] = collection
	}

	c := &copyCollections{
		conversations: loaded["conversations"],
		participants:  loaded[participants.CollectionName],
		publicKeys:    loaded["conversation_public_keys"],
		secretKeys:    loaded["conversation_secret_keys"],
		messages:      loaded["messages"],
	}
	if withRedaction {
		c.redactionKeys = loaded[redactionKeysCollectionName]
		c.redactionEntries = loaded[redactionEntriesCollectionName]
	}
	return c, nil
}

func recordExists(app core.App, collection, id string) bool {
	if strings.TrimSpace(id) == "" {
		return false
	}
	_, err := app.FindRecordById(collection, id)
	return err == nil
}

func idMapContainsValue(idMap map[string]string, value string) bool {
	if value == "" {
		return false
	}
	for _, v := range idMap {
		if v == value {
			return true
		}
	}
	return false
}

// copyMessageExpiry mirrors the per-message expiry a fresh conversation would
// stamp: derived from the duplicate's expiry_duration, not copied from the
// source rows (spec). Returns the zero time when the duplicate never
// expires.
func copyMessageExpiry(expiryDuration string) time.Time {
	duration, err := time.ParseDuration(expiryDuration)
	if err != nil || duration <= 0 {
		return time.Time{}
	}
	return time.Now().UTC().Add(duration)
}
