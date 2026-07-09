package handler

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/participants"
	"github.com/cognos-io/chat.cognos.io/backend/internal/projectparticipants"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const projectConversationKeysCollection = "project_conversation_keys"

type projectConversationResponse struct {
	ID             string `json:"id"`
	Created        string `json:"created"`
	Updated        string `json:"updated"`
	LastActivityAt string `json:"last_activity_at,omitempty"`
	Data           string `json:"data"`
	Project        string `json:"project"`
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

type updateConversationProjectRequest struct {
	// ProjectID is the target project. Empty removes the conversation from its
	// current project and makes it standalone.
	ProjectID string `json:"project_id"`
	// WrappedConversationSecretKey is required when moving into a project. It is
	// the existing conversation secret key wrapped by the target project's
	// current content key.
	WrappedConversationSecretKey string `json:"wrapped_conversation_secret_key"`
	// WrappedSecretKey is required when removing from a project. It is the
	// existing conversation secret key wrapped for the caller's Account key.
	WrappedSecretKey string `json:"wrapped_secret_key"`
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
			return conversationActivityTimestamp(records[i]) > conversationActivityTimestamp(records[j])
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

// ConversationProjectUpdate moves a conversation into a project, between
// projects, or out to standalone. It changes both access metadata and key
// wrapping in one transaction so the conversation is never half-moved.
func ConversationProjectUpdate(app core.App) func(e *core.RequestEvent) error {
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
		sourceProjectID := conversation.GetString("project")

		var req updateConversationProjectRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		targetProjectID := strings.TrimSpace(req.ProjectID)
		wrappedProjectSecretKey := strings.TrimSpace(req.WrappedConversationSecretKey)
		wrappedCallerSecretKey := strings.TrimSpace(req.WrappedSecretKey)

		if targetProjectID == sourceProjectID {
			return apis.NewBadRequestError("Conversation is already in that project", nil)
		}
		if targetProjectID != "" && wrappedProjectSecretKey == "" {
			return apis.NewBadRequestError("wrapped_conversation_secret_key is required", nil)
		}
		if targetProjectID == "" && sourceProjectID == "" {
			return apis.NewBadRequestError("Conversation is already standalone", nil)
		}
		if targetProjectID == "" && wrappedCallerSecretKey == "" {
			return apis.NewBadRequestError("wrapped_secret_key is required", nil)
		}

		if sourceProjectID != "" {
			if err := requireProjectAdmin(app, sourceProjectID, caller.ID); err != nil {
				return err
			}
		} else {
			role, _, err := participants.NewPocketBaseRepo(app).ActiveRole(conversationID, caller.ID)
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to verify conversation role", err)
			}
			if role != participants.RoleAdmin {
				return apis.NewForbiddenError("Only conversation admins can move this conversation", nil)
			}
		}

		var targetProject *core.Record
		if targetProjectID != "" {
			targetProject, err = accessibleProjectRecord(app, e, targetProjectID)
			if err != nil {
				return err
			}
			if err := requireProjectAdmin(app, targetProjectID, caller.ID); err != nil {
				return err
			}
		}

		keyVersion := conversation.GetInt("key_version")
		if keyVersion < 1 {
			keyVersion = 1
		}

		if err := app.RunInTransaction(func(txApp core.App) error {
			if err := deleteConversationAccessRows(txApp, conversationID); err != nil {
				return err
			}

			if targetProjectID != "" {
				conversation.Set("project", targetProjectID)
				if err := txApp.Save(conversation); err != nil {
					return err
				}

				collection, err := txApp.FindCollectionByNameOrId(projectConversationKeysCollection)
				if err != nil {
					return err
				}
				wrapping := core.NewRecord(collection)
				wrapping.Set("project", targetProjectID)
				wrapping.Set("conversation", conversationID)
				wrapping.Set("conversation_key_version", keyVersion)
				wrapping.Set("project_key_version", projectKeyVersionOf(targetProject))
				wrapping.Set("wrapped_conversation_secret_key", wrappedProjectSecretKey)
				return txApp.Save(wrapping)
			}

			conversation.Set("project", "")
			if err := txApp.Save(conversation); err != nil {
				return err
			}

			if err := upsertCallerAdminParticipant(txApp, conversationID, caller.ID); err != nil {
				return err
			}
			collection, err := txApp.FindCollectionByNameOrId("conversation_secret_keys")
			if err != nil {
				return err
			}
			secretKey := core.NewRecord(collection)
			secretKey.Set("conversation", conversationID)
			secretKey.Set("user", caller.ID)
			secretKey.Set("secret_key", wrappedCallerSecretKey)
			secretKey.Set("key_version", keyVersion)
			return txApp.Save(secretKey)
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to update conversation project", err)
		}

		return e.JSON(http.StatusOK, conversationRecordToResponse(conversation))
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
		conversation.Set("last_activity_at", time.Now().UTC())

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

func requireProjectAdmin(app core.App, projectID, userID string) error {
	role, active, err := projectparticipants.NewPocketBaseRepo(app).ActiveRole(projectID, userID)
	if err != nil {
		return apis.NewApiError(http.StatusInternalServerError, "Failed to verify project role", err)
	}
	if !active {
		return apis.NewNotFoundError("Project not found", nil)
	}
	if role != projectparticipants.RoleAdmin {
		return apis.NewForbiddenError("Only project admins can move conversations", nil)
	}
	return nil
}

func deleteConversationAccessRows(app core.App, conversationID string) error {
	for _, collection := range []string{
		participants.CollectionName,
		"conversation_secret_keys",
		projectConversationKeysCollection,
	} {
		records, err := app.FindRecordsByFilter(
			collection,
			"conversation = {:c}",
			"",
			500,
			0,
			dbx.Params{"c": conversationID},
		)
		if err != nil {
			return err
		}
		for _, record := range records {
			if err := app.Delete(record); err != nil {
				return err
			}
		}
	}
	return nil
}

func upsertCallerAdminParticipant(app core.App, conversationID, userID string) error {
	collection, err := app.FindCollectionByNameOrId(participants.CollectionName)
	if err != nil {
		return err
	}

	record, _ := app.FindFirstRecordByFilter(
		participants.CollectionName,
		"conversation = {:conversation} && user = {:user}",
		dbx.Params{"conversation": conversationID, "user": userID},
	)
	if record == nil {
		record = core.NewRecord(collection)
		record.Set("conversation", conversationID)
		record.Set("user", userID)
	}
	record.Set("role", string(participants.RoleAdmin))
	record.Set("added_at", time.Now().UTC())
	record.Set("removed_at", "")
	return app.Save(record)
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
		LastActivityAt:               record.GetString("last_activity_at"),
		Data:                         record.GetString("data"),
		Project:                      record.GetString("project"),
		KeyVersion:                   keyVersion,
		ProjectKeyVersion:            projectKeyVersion,
		WrappedConversationSecretKey: wrappedSecretKey,
	}
}
