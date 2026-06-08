package handler

import (
	"net/http"
	"strings"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/forms"
)

type userKeyPairRecordResponse struct {
	ID             string `json:"id"`
	Created        string `json:"created"`
	Updated        string `json:"updated"`
	CollectionID   string `json:"collectionId"`
	CollectionName string `json:"collectionName"`
	PasswordSalt   string `json:"password_salt,omitempty"`
	PublicKey      string `json:"public_key"`
	RecordMAC      string `json:"record_mac,omitempty"`
	SecretKey      string `json:"secret_key"`
	UnlockScheme   string `json:"unlock_scheme,omitempty"`
	User           string `json:"user"`
}

type createUserKeyPairRequest struct {
	PasswordSalt string `json:"password_salt,omitempty"`
	PublicKey    string `json:"public_key"`
	RecordMAC    string `json:"record_mac,omitempty"`
	SecretKey    string `json:"secret_key"`
	UnlockScheme string `json:"unlock_scheme,omitempty"`
}

type updateUserKeyPairRequest struct {
	RecordMAC string `json:"record_mac"`
}

type conversationPublicKeyRecordResponse struct {
	ID                 string `json:"id"`
	Created            string `json:"created"`
	Updated            string `json:"updated"`
	CollectionID       string `json:"collectionId"`
	CollectionName     string `json:"collectionName"`
	Conversation       string `json:"conversation"`
	PublicKey          string `json:"public_key,omitempty"`
	PublicKeySignature string `json:"public_key_signature,omitempty"`
}

type createConversationPublicKeyRequest struct {
	PublicKey          string `json:"public_key"`
	PublicKeySignature string `json:"public_key_signature,omitempty"`
}

type updateConversationPublicKeyRequest struct {
	PublicKeySignature string `json:"public_key_signature"`
}

type conversationSecretKeyRecordResponse struct {
	ID             string `json:"id"`
	Created        string `json:"created"`
	Updated        string `json:"updated"`
	CollectionID   string `json:"collectionId"`
	CollectionName string `json:"collectionName"`
	Conversation   string `json:"conversation"`
	SecretKey      string `json:"secret_key,omitempty"`
	User           string `json:"user"`
	// KeyVersion is the conversation generation this wrapped secret key was
	// produced against. A client that caches the secret key should also
	// persist the version so a rotation invalidates the cache on next
	// refresh without leaking access to participants who have been removed.
	KeyVersion int `json:"key_version"`
}

type createConversationSecretKeyRequest struct {
	SecretKey string `json:"secret_key"`
}

type userPreferencesRecordResponse struct {
	ID             string `json:"id"`
	Created        string `json:"created"`
	Updated        string `json:"updated"`
	CollectionID   string `json:"collectionId"`
	CollectionName string `json:"collectionName"`
	Data           string `json:"data"`
	User           string `json:"user"`
}

type createUserPreferencesRequest struct {
	Data string `json:"data"`
}

type updateUserPreferencesRequest struct {
	Data string `json:"data"`
}

type vaultSessionRecordResponse struct {
	WrapKey string `json:"wrap_key"`
}

type upsertVaultSessionRequest struct {
	WrapKey string `json:"wrap_key"`
}

func UserKeyPairGet(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := ownedUserKeyPairRecord(app, e, "")
		if err != nil {
			return err
		}

		return e.JSON(http.StatusOK, userKeyPairRecordToResponse(record))
	}
}

func UserKeyPairCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		var req createUserKeyPairRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if strings.TrimSpace(req.PublicKey) == "" || strings.TrimSpace(req.SecretKey) == "" {
			return apis.NewBadRequestError("public_key and secret_key are required", nil)
		}

		collection, err := app.FindCollectionByNameOrId("user_key_pairs")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load user key pairs collection", err)
		}

		record := core.NewRecord(collection)
		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{
			"password_salt": req.PasswordSalt,
			"public_key":    req.PublicKey,
			"record_mac":    req.RecordMAC,
			"secret_key":    req.SecretKey,
			"unlock_scheme": req.UnlockScheme,
			"user":          user.ID,
		})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to create user key pair", err)
		}

		return e.JSON(http.StatusCreated, userKeyPairRecordToResponse(record))
	}
}

func UserKeyPairUpdate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := ownedUserKeyPairRecord(app, e, e.Request.PathValue("keyPairID"))
		if err != nil {
			return err
		}

		var req updateUserKeyPairRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if strings.TrimSpace(req.RecordMAC) == "" {
			return apis.NewBadRequestError("record_mac is required", nil)
		}

		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{"record_mac": req.RecordMAC})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to update user key pair", err)
		}

		return e.JSON(http.StatusOK, userKeyPairRecordToResponse(record))
	}
}

func ConversationPublicKeyGet(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := ownedConversationPublicKeyRecord(
			app,
			e,
			e.Request.PathValue("conversationID"),
			"",
		)
		if err != nil {
			return err
		}

		return e.JSON(http.StatusOK, conversationPublicKeyRecordToResponse(record))
	}
}

func ConversationPublicKeyCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		conversationID := e.Request.PathValue("conversationID")
		if _, err := ownedConversationRecord(app, e, conversationID); err != nil {
			return err
		}

		var req createConversationPublicKeyRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if strings.TrimSpace(req.PublicKey) == "" {
			return apis.NewBadRequestError("public_key is required", nil)
		}

		collection, err := app.FindCollectionByNameOrId("conversation_public_keys")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load conversation public keys collection", err)
		}

		record := core.NewRecord(collection)
		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{
			"conversation":         conversationID,
			"public_key":           req.PublicKey,
			"public_key_signature": req.PublicKeySignature,
		})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to create conversation public key", err)
		}

		return e.JSON(http.StatusCreated, conversationPublicKeyRecordToResponse(record))
	}
}

func ConversationPublicKeyUpdate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := ownedConversationPublicKeyRecord(
			app,
			e,
			e.Request.PathValue("conversationID"),
			e.Request.PathValue("publicKeyID"),
		)
		if err != nil {
			return err
		}

		var req updateConversationPublicKeyRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if strings.TrimSpace(req.PublicKeySignature) == "" {
			return apis.NewBadRequestError("public_key_signature is required", nil)
		}

		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{"public_key_signature": req.PublicKeySignature})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to update conversation public key", err)
		}

		return e.JSON(http.StatusOK, conversationPublicKeyRecordToResponse(record))
	}
}

func ConversationSecretKeyGet(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := ownedConversationSecretKeyRecord(app, e, e.Request.PathValue("conversationID"))
		if err != nil {
			return err
		}

		return e.JSON(http.StatusOK, conversationSecretKeyRecordToResponse(record))
	}
}

func ConversationSecretKeyCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		conversationID := e.Request.PathValue("conversationID")
		conversationRecord, err := ownedConversationRecord(app, e, conversationID)
		if err != nil {
			return err
		}

		var req createConversationSecretKeyRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if strings.TrimSpace(req.SecretKey) == "" {
			return apis.NewBadRequestError("secret_key is required", nil)
		}

		collection, err := app.FindCollectionByNameOrId("conversation_secret_keys")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load conversation secret keys collection", err)
		}

		// Stamp the wrapped key with the conversation's current generation
		// so future rotation can invalidate stale wrappers without deleting
		// the row outright (preserves the audit trail).
		keyVersion := conversationRecord.GetInt("key_version")
		if keyVersion < 1 {
			keyVersion = 1
		}

		record := core.NewRecord(collection)
		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{
			"conversation": conversationID,
			"secret_key":   req.SecretKey,
			"user":         user.ID,
			"key_version":  keyVersion,
		})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to create conversation secret key", err)
		}

		return e.JSON(http.StatusCreated, conversationSecretKeyRecordToResponse(record))
	}
}

func UserPreferencesGet(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := ownedUserPreferencesRecord(app, e, "")
		if err != nil {
			return err
		}

		return e.JSON(http.StatusOK, userPreferencesRecordToResponse(record))
	}
}

func UserPreferencesCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		var req createUserPreferencesRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if strings.TrimSpace(req.Data) == "" {
			return apis.NewBadRequestError("data is required", nil)
		}

		collection, err := app.FindCollectionByNameOrId("user_preferences")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load user preferences collection", err)
		}

		record := core.NewRecord(collection)
		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{
			"data": req.Data,
			"user": user.ID,
		})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to create user preferences", err)
		}

		return e.JSON(http.StatusCreated, userPreferencesRecordToResponse(record))
	}
}

func UserPreferencesUpdate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, err := ownedUserPreferencesRecord(app, e, e.Request.PathValue("preferencesID"))
		if err != nil {
			return err
		}

		var req updateUserPreferencesRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if strings.TrimSpace(req.Data) == "" {
			return apis.NewBadRequestError("data is required", nil)
		}

		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{"data": req.Data})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to update user preferences", err)
		}

		return e.JSON(http.StatusOK, userPreferencesRecordToResponse(record))
	}
}

// wrapKeyPattern bounds the wrap key to a 32-byte (256-bit) AES key encoded as
// base64. Tightening past the generic base64 column regex keeps junk payloads
// out without leaning on a runtime length check.
const wrapKeyBase64Length = 44

func VaultSessionGet(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		record, err := app.FindFirstRecordByData("vault_session_wrap_keys", "user", user.ID)
		if err != nil {
			return apis.NewNotFoundError("Vault session not found", err)
		}

		return e.JSON(http.StatusOK, vaultSessionRecordResponse{
			WrapKey: record.GetString("wrap_key"),
		})
	}
}

func VaultSessionUpsert(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		var req upsertVaultSessionRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		wrapKey := strings.TrimSpace(req.WrapKey)
		if len(wrapKey) != wrapKeyBase64Length {
			return apis.NewBadRequestError("wrap_key must be a base64-encoded 32-byte key", nil)
		}

		record, err := app.FindFirstRecordByData("vault_session_wrap_keys", "user", user.ID)
		if err != nil {
			collection, err := app.FindCollectionByNameOrId("vault_session_wrap_keys")
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to load vault session collection", err)
			}
			record = core.NewRecord(collection)
		}

		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{
			"user":     user.ID,
			"wrap_key": wrapKey,
		})
		if err := form.Submit(); err != nil {
			return apis.NewBadRequestError("Failed to save vault session", err)
		}

		return e.JSON(http.StatusOK, vaultSessionRecordResponse{
			WrapKey: record.GetString("wrap_key"),
		})
	}
}

func VaultSessionDelete(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		record, err := app.FindFirstRecordByData("vault_session_wrap_keys", "user", user.ID)
		if err != nil {
			return e.NoContent(http.StatusNoContent)
		}

		if err := app.Delete(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete vault session", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}

func ownedUserKeyPairRecord(app core.App, e *core.RequestEvent, keyPairID string) (*core.Record, error) {
	user := auth.ExtractUser(e)
	if user == nil {
		return nil, apis.NewUnauthorizedError("User not authenticated", nil)
	}

	if keyPairID != "" {
		record, err := app.FindRecordById("user_key_pairs", keyPairID)
		if err != nil {
			return nil, apis.NewNotFoundError("User key pair not found", err)
		}
		if record.GetString("user") != user.ID {
			return nil, apis.NewNotFoundError("User key pair not found", nil)
		}
		return record, nil
	}

	record, err := app.FindFirstRecordByData("user_key_pairs", "user", user.ID)
	if err != nil {
		return nil, apis.NewNotFoundError("User key pair not found", err)
	}

	return record, nil
}

func ownedConversationPublicKeyRecord(app core.App, e *core.RequestEvent, conversationID string, publicKeyID string) (*core.Record, error) {
	if _, err := ownedConversationRecord(app, e, conversationID); err != nil {
		return nil, err
	}

	if publicKeyID != "" {
		record, err := app.FindRecordById("conversation_public_keys", publicKeyID)
		if err != nil {
			return nil, apis.NewNotFoundError("Conversation public key not found", err)
		}
		if record.GetString("conversation") != conversationID {
			return nil, apis.NewNotFoundError("Conversation public key not found", nil)
		}
		return record, nil
	}

	records, err := app.FindRecordsByFilter(
		"conversation_public_keys",
		"conversation={:conversation_id}",
		"",
		1,
		0,
		dbx.Params{"conversation_id": conversationID},
	)
	if err != nil || len(records) == 0 {
		return nil, apis.NewNotFoundError("Conversation public key not found", err)
	}

	return records[0], nil
}

func ownedConversationSecretKeyRecord(app core.App, e *core.RequestEvent, conversationID string) (*core.Record, error) {
	user := auth.ExtractUser(e)
	if user == nil {
		return nil, apis.NewUnauthorizedError("User not authenticated", nil)
	}
	if _, err := ownedConversationRecord(app, e, conversationID); err != nil {
		return nil, err
	}

	records, err := app.FindRecordsByFilter(
		"conversation_secret_keys",
		"conversation={:conversation_id} && user={:user_id}",
		"",
		1,
		0,
		dbx.Params{"conversation_id": conversationID, "user_id": user.ID},
	)
	if err != nil || len(records) == 0 {
		return nil, apis.NewNotFoundError("Conversation secret key not found", err)
	}

	return records[0], nil
}

func ownedUserPreferencesRecord(app core.App, e *core.RequestEvent, preferencesID string) (*core.Record, error) {
	user := auth.ExtractUser(e)
	if user == nil {
		return nil, apis.NewUnauthorizedError("User not authenticated", nil)
	}

	if preferencesID != "" {
		record, err := app.FindRecordById("user_preferences", preferencesID)
		if err != nil {
			return nil, apis.NewNotFoundError("User preferences not found", err)
		}
		if record.GetString("user") != user.ID {
			return nil, apis.NewNotFoundError("User preferences not found", nil)
		}
		return record, nil
	}

	record, err := app.FindFirstRecordByData("user_preferences", "user", user.ID)
	if err != nil {
		return nil, apis.NewNotFoundError("User preferences not found", err)
	}

	return record, nil
}

func userKeyPairRecordToResponse(record *core.Record) userKeyPairRecordResponse {
	return userKeyPairRecordResponse{
		ID:             record.Id,
		Created:        record.GetString("created"),
		Updated:        record.GetString("updated"),
		CollectionID:   record.Collection().Id,
		CollectionName: record.Collection().Name,
		PasswordSalt:   record.GetString("password_salt"),
		PublicKey:      record.GetString("public_key"),
		RecordMAC:      record.GetString("record_mac"),
		SecretKey:      record.GetString("secret_key"),
		UnlockScheme:   record.GetString("unlock_scheme"),
		User:           record.GetString("user"),
	}
}

func conversationPublicKeyRecordToResponse(record *core.Record) conversationPublicKeyRecordResponse {
	return conversationPublicKeyRecordResponse{
		ID:                 record.Id,
		Created:            record.GetString("created"),
		Updated:            record.GetString("updated"),
		CollectionID:       record.Collection().Id,
		CollectionName:     record.Collection().Name,
		Conversation:       record.GetString("conversation"),
		PublicKey:          record.GetString("public_key"),
		PublicKeySignature: record.GetString("public_key_signature"),
	}
}

func conversationSecretKeyRecordToResponse(record *core.Record) conversationSecretKeyRecordResponse {
	version := record.GetInt("key_version")
	if version < 1 {
		version = 1
	}
	return conversationSecretKeyRecordResponse{
		ID:             record.Id,
		Created:        record.GetString("created"),
		Updated:        record.GetString("updated"),
		CollectionID:   record.Collection().Id,
		CollectionName: record.Collection().Name,
		Conversation:   record.GetString("conversation"),
		SecretKey:      record.GetString("secret_key"),
		User:           record.GetString("user"),
		KeyVersion:     version,
	}
}

func userPreferencesRecordToResponse(record *core.Record) userPreferencesRecordResponse {
	return userPreferencesRecordResponse{
		ID:             record.Id,
		Created:        record.GetString("created"),
		Updated:        record.GetString("updated"),
		CollectionID:   record.Collection().Id,
		CollectionName: record.Collection().Name,
		Data:           record.GetString("data"),
		User:           record.GetString("user"),
	}
}
