package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/participants"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const maxImportMessages = 10_000

type importMessageInput struct {
	ID            string `json:"id"`
	ParentMessage string `json:"parent_message,omitempty"`
	Data          string `json:"data"`
}

type conversationImportRequest struct {
	ImportID     string                `json:"import_id"`
	Source       string                `json:"source"`
	Conversation copyConversationInput `json:"conversation"`
	Messages     []importMessageInput  `json:"messages"`
}

// ConversationImport atomically persists one client-encrypted imported
// Conversation. The request contains no historical plaintext; the backend only
// validates ids, the parent graph and ciphertext-shaped storage fields.
func ConversationImport(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		var req conversationImportRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if err := validateConversationImport(req); err != nil {
			return err
		}
		digestBytes, err := json.Marshal(req)
		if err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		digest := sha256.Sum256(digestBytes)
		digestHex := hex.EncodeToString(digest[:])

		if receipt, err := app.FindFirstRecordByFilter(
			"conversation_import_receipts",
			"user = {:user} && import_id = {:import}",
			dbx.Params{"user": caller.ID, "import": req.ImportID},
		); err == nil {
			if receipt.GetString("request_digest") != digestHex {
				return apis.NewApiError(http.StatusConflict, "Import id was already used", nil)
			}
			conversation, findErr := app.FindRecordById("conversations", receipt.GetString("conversation"))
			if findErr != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Import receipt is incomplete", findErr)
			}
			return e.JSON(http.StatusOK, copyConversationResponse{
				Conversation: conversationRecordToResponse(conversation),
				MessageCount: receipt.GetInt("message_count"),
			})
		}

		if recordExists(app, "conversations", req.Conversation.ID) {
			return apis.NewApiError(http.StatusConflict, "Conversation id already exists", nil)
		}
		for _, message := range req.Messages {
			if recordExists(app, "messages", message.ID) {
				return apis.NewApiError(http.StatusConflict, "Message id already exists", nil)
			}
		}
		conversation, err := writeConversationImport(app, caller.ID, req, digestHex)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusCreated, copyConversationResponse{
			Conversation: conversationRecordToResponse(conversation),
			MessageCount: len(req.Messages),
		})
	}
}

func validateConversationImport(req conversationImportRequest) error {
	if len(req.ImportID) < 16 || len(req.ImportID) > 64 {
		return apis.NewBadRequestError("import_id is invalid", nil)
	}
	if req.Source != "chatgpt" && req.Source != "claude" {
		return apis.NewBadRequestError("source is invalid", nil)
	}
	if err := validateCopyConversationInput(req.Conversation); err != nil {
		return err
	}
	if len(req.Messages) == 0 || len(req.Messages) > maxImportMessages {
		return apis.NewBadRequestError("message count is invalid", nil)
	}
	seen := make(map[string]bool, len(req.Messages))
	for _, message := range req.Messages {
		id := strings.TrimSpace(message.ID)
		parent := strings.TrimSpace(message.ParentMessage)
		if id == "" || strings.TrimSpace(message.Data) == "" || seen[id] {
			return apis.NewBadRequestError("each message requires a unique id and data", nil)
		}
		if parent != "" && !seen[parent] {
			return apis.NewBadRequestError("message parent must precede its child", nil)
		}
		seen[id] = true
	}
	return nil
}

func writeConversationImport(
	app core.App,
	callerID string,
	req conversationImportRequest,
	digest string,
) (*core.Record, error) {
	collections, err := loadCopyCollections(app, false)
	if err != nil {
		return nil, err
	}
	receipts, err := app.FindCollectionByNameOrId("conversation_import_receipts")
	if err != nil {
		return nil, apis.NewApiError(http.StatusInternalServerError, "Failed to load collection", err)
	}
	now := time.Now().UTC()
	conversation := core.NewRecord(collections.conversations)
	conversation.Id = strings.TrimSpace(req.Conversation.ID)
	err = app.RunInTransaction(func(txApp core.App) error {
		conversation.Set("creator", callerID)
		conversation.Set("data", req.Conversation.Data)
		conversation.Set("expiry_duration", req.Conversation.ExpiryDuration)
		conversation.Set("key_version", 1)
		conversation.Set("last_activity_at", now)
		if err := txApp.Save(conversation); err != nil {
			return err
		}

		participant := core.NewRecord(collections.participants)
		participant.Set("conversation", conversation.Id)
		participant.Set("user", callerID)
		participant.Set("role", string(participants.RoleAdmin))
		participant.Set("added_at", now)
		if err := txApp.Save(participant); err != nil {
			return err
		}

		publicKey := core.NewRecord(collections.publicKeys)
		publicKey.Set("conversation", conversation.Id)
		publicKey.Set("public_key", req.Conversation.PublicKey)
		publicKey.Set("public_key_signature", req.Conversation.PublicKeySignature)
		publicKey.Set("key_version", 1)
		if err := txApp.Save(publicKey); err != nil {
			return err
		}

		secretKey := core.NewRecord(collections.secretKeys)
		secretKey.Set("conversation", conversation.Id)
		secretKey.Set("user", callerID)
		secretKey.Set("secret_key", req.Conversation.WrappedSecretKey)
		secretKey.Set("key_version", 1)
		if err := txApp.Save(secretKey); err != nil {
			return err
		}

		expires := copyMessageExpiry(req.Conversation.ExpiryDuration)
		for _, input := range req.Messages {
			message := core.NewRecord(collections.messages)
			message.Id = strings.TrimSpace(input.ID)
			message.Set("conversation", conversation.Id)
			message.Set("parent_message", strings.TrimSpace(input.ParentMessage))
			message.Set("data", input.Data)
			if !expires.IsZero() {
				message.Set("expires", expires)
			}
			if err := txApp.Save(message); err != nil {
				return err
			}
		}

		receipt := core.NewRecord(receipts)
		receipt.Set("user", callerID)
		receipt.Set("import_id", req.ImportID)
		receipt.Set("request_digest", digest)
		receipt.Set("conversation", conversation.Id)
		receipt.Set("message_count", len(req.Messages))
		return txApp.Save(receipt)
	})
	if err != nil {
		return nil, apis.NewBadRequestError("Failed to import conversation", err)
	}
	return conversation, nil
}
