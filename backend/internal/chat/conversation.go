package chat

import (
	"errors"
	"net/http"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

type Conversation struct {
	ID             string        `json:"id"`
	PublicKey      [32]byte      `json:"public_key"`
	ExpiryDuration time.Duration `json:"expiry_duration"`
}

type ActivityReason string

const (
	ActivityMessageCreated      ActivityReason = "message_created"
	ActivityMessageUpdated      ActivityReason = "message_updated"
	ActivityMessageDeleted      ActivityReason = "message_deleted"
	ActivityConversationUpdated ActivityReason = "conversation_updated"
)

type ConversationRepo interface {
	ByID(id string) (Conversation, error)
	BumpActivity(conversationID string, reason ActivityReason) error
}

type PocketBaseConversationRepo struct {
	app         core.App
	collection  *core.Collection
	keyPairRepo auth.KeyPairRepo
}

// BumpActivity stamps the last user-visible conversation activity. The reason
// is intentionally metadata-only; never pass message content here.
func (r *PocketBaseConversationRepo) BumpActivity(
	conversationID string,
	reason ActivityReason,
) error {
	if conversationID == "" {
		return nil
	}

	record, err := r.app.FindRecordById(r.collection.Name, conversationID)
	if err != nil {
		return err
	}
	record.Set("last_activity_at", time.Now().UTC())

	return r.app.Save(record)
}

// ByID returns a conversation by its ID.
func (r *PocketBaseConversationRepo) ByID(id string) (Conversation, error) {
	conversation := Conversation{}

	record, err := r.app.FindRecordById(r.collection.Name, id)
	if err != nil {
		return conversation, err
	}

	conversation.ID = record.Id

	// An empty or legacy invalid value means that the conversation does not expire.
	duration, _ := time.ParseDuration(record.GetString("expiry_duration"))
	conversation.ExpiryDuration = duration

	// Get the public key for the conversation
	publicKey, err := r.keyPairRepo.ConversationPublicKey(conversation.ID)
	if errors.Is(err, auth.ErrNoKeyPair) {
		return conversation, apis.NewNotFoundError(
			"Conversation public key not found",
			nil,
		)
	}
	if err != nil {
		return conversation, apis.NewApiError(
			http.StatusInternalServerError,
			"Failed to get conversation public key",
			err,
		)
	}
	conversation.PublicKey = publicKey

	return conversation, nil
}

func NewPocketBaseConversationRepo(
	app core.App,
	keyPairRepo auth.KeyPairRepo,
) *PocketBaseConversationRepo {
	collection, err := app.FindCollectionByNameOrId("conversations")
	if err != nil {
		panic(err)
	}
	return &PocketBaseConversationRepo{
		app:         app,
		collection:  collection,
		keyPairRepo: keyPairRepo,
	}
}
