package handler

import (
	"net/http"
	"sort"
	"strings"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/projectparticipants"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const projectConversationKeysCollection = "project_conversation_keys"

type projectConversationResponse struct {
	ID      string `json:"id"`
	Created string `json:"created"`
	Updated string `json:"updated"`
	Data    string `json:"data"`
	Project string `json:"project"`
	// KeyVersion is the conversation's own key generation; ProjectKeyVersion is
	// the project content-key generation that wrapped the secret key below.
	KeyVersion        int `json:"key_version"`
	ProjectKeyVersion int `json:"project_key_version"`
	// WrappedConversationSecretKey is the conversation secret key wrapped by the
	// project content key. A project member opens the project content key, then
	// this, to reconstruct the conversation keypair and decrypt messages.
	WrappedConversationSecretKey string `json:"wrapped_conversation_secret_key,omitempty"`
}

type createProjectConversationRequest struct {
	// Data is the encrypted conversation metadata (title) blob (base64).
	Data string `json:"data"`
	// PublicKey is the conversation public key (base64). The backend stores it
	// so it can seal persisted AI responses, exactly as for standalone
	// conversations.
	PublicKey          string `json:"public_key"`
	PublicKeySignature string `json:"public_key_signature,omitempty"`
	// WrappedConversationSecretKey is the conversation secret key wrapped by the
	// project content key (base64).
	WrappedConversationSecretKey string `json:"wrapped_conversation_secret_key"`
}

// ProjectConversationsList returns the conversations inside a project the
// caller can access. Each entry carries its project-wrapped secret key so the
// client can decrypt in one round-trip. Non-members get 404 (via
// accessibleProjectRecord).
func ProjectConversationsList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		projectID := e.Request.PathValue("projectID")
		project, err := accessibleProjectRecord(app, e, projectID)
		if err != nil {
			return err
		}

		projectKeyVersion := projectKeyVersionOf(project)

		records, err := app.FindAllRecords(
			"conversations",
			dbx.HashExp{"project": projectID},
		)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list project conversations", err)
		}
		sort.Slice(records, func(i, j int) bool {
			return records[i].GetString("updated") > records[j].GetString("updated")
		})

		response := make([]projectConversationResponse, 0, len(records))
		for _, record := range records {
			wrapped, err := projectConversationWrappedKey(app, record.Id, projectKeyVersion)
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to load project conversation key", err)
			}
			response = append(response, projectConversationToResponse(record, projectKeyVersion, wrapped))
		}

		return e.JSON(http.StatusOK, response)
	}
}

// ProjectConversationsCreate creates a conversation inside a project. The
// conversation, its public key, and the project-wrapped secret key are written
// in one transaction. Project conversations carry NO conversation-participant
// rows and NO per-user secret-key rows — access flows through project
// membership and the secret key is wrapped by the project content key.
func ProjectConversationsCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		projectID := e.Request.PathValue("projectID")
		project, err := accessibleProjectRecord(app, e, projectID)
		if err != nil {
			return err
		}

		// Viewers can read project content but not create conversations.
		role, _, err := projectparticipants.NewPocketBaseRepo(app).ActiveRole(projectID, caller.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify project role", err)
		}
		if role == projectparticipants.RoleViewer {
			return apis.NewForbiddenError("Viewers cannot create project conversations", nil)
		}

		var req createProjectConversationRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		req.Data = strings.TrimSpace(req.Data)
		req.PublicKey = strings.TrimSpace(req.PublicKey)
		req.WrappedConversationSecretKey = strings.TrimSpace(req.WrappedConversationSecretKey)
		if req.Data == "" {
			return apis.NewBadRequestError("Conversation data is required", nil)
		}
		if req.PublicKey == "" {
			return apis.NewBadRequestError("public_key is required", nil)
		}
		if req.WrappedConversationSecretKey == "" {
			return apis.NewBadRequestError("wrapped_conversation_secret_key is required", nil)
		}

		projectKeyVersion := projectKeyVersionOf(project)

		conversationsCollection, err := app.FindCollectionByNameOrId("conversations")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load conversations collection", err)
		}
		publicKeysCollection, err := app.FindCollectionByNameOrId("conversation_public_keys")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load conversation public keys collection", err)
		}
		conversationKeysCollection, err := app.FindCollectionByNameOrId(projectConversationKeysCollection)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load project conversation keys collection", err)
		}

		conversation := core.NewRecord(conversationsCollection)
		conversation.Set("creator", caller.ID)
		conversation.Set("project", projectID)
		conversation.Set("data", req.Data)
		conversation.Set("key_version", 1)

		if err := app.RunInTransaction(func(txApp core.App) error {
			if err := txApp.Save(conversation); err != nil {
				return err
			}

			publicKey := core.NewRecord(publicKeysCollection)
			publicKey.Set("conversation", conversation.Id)
			publicKey.Set("public_key", req.PublicKey)
			publicKey.Set("public_key_signature", req.PublicKeySignature)
			publicKey.Set("key_version", 1)
			if err := txApp.Save(publicKey); err != nil {
				return err
			}

			wrappedKey := core.NewRecord(conversationKeysCollection)
			wrappedKey.Set("project", projectID)
			wrappedKey.Set("conversation", conversation.Id)
			wrappedKey.Set("conversation_key_version", 1)
			wrappedKey.Set("project_key_version", projectKeyVersion)
			wrappedKey.Set("wrapped_conversation_secret_key", req.WrappedConversationSecretKey)
			return txApp.Save(wrappedKey)
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to create project conversation", err)
		}

		return e.JSON(
			http.StatusCreated,
			projectConversationToResponse(conversation, projectKeyVersion, req.WrappedConversationSecretKey),
		)
	}
}

func projectConversationWrappedKey(app core.App, conversationID string, projectKeyVersion int) (string, error) {
	record, err := app.FindFirstRecordByFilter(
		projectConversationKeysCollection,
		"conversation = {:c} && project_key_version = {:v}",
		dbx.Params{"c": conversationID, "v": projectKeyVersion},
	)
	if err != nil || record == nil {
		return "", nil
	}
	return record.GetString("wrapped_conversation_secret_key"), nil
}

func projectKeyVersionOf(project *core.Record) int {
	version := project.GetInt("key_version")
	if version < 1 {
		version = 1
	}
	return version
}

func projectConversationToResponse(
	record *core.Record,
	projectKeyVersion int,
	wrappedSecretKey string,
) projectConversationResponse {
	keyVersion := record.GetInt("key_version")
	if keyVersion < 1 {
		keyVersion = 1
	}
	return projectConversationResponse{
		ID:                           record.Id,
		Created:                      record.GetString("created"),
		Updated:                      record.GetString("updated"),
		Data:                         record.GetString("data"),
		Project:                      record.GetString("project"),
		KeyVersion:                   keyVersion,
		ProjectKeyVersion:            projectKeyVersion,
		WrappedConversationSecretKey: wrappedSecretKey,
	}
}
