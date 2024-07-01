package chat

import (
	"errors"
	"net/http"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/models"
)

type Conversation struct {
	ID             string        `json:"id"`
	PublicKey      [32]byte      `json:"public_key"`
	ExpiryDuration time.Duration `json:"expiry_duration"`
}

type ConversationRepo interface {
	ByID(id string) (Conversation, error)
	SetConversationUpdated(conversationID string) error
}

type PocketBaseConversationRepo struct {
	app         core.App
	collection  *models.Collection
	keyPairRepo auth.KeyPairRepo
}

// SetConversationUpdated updates the conversation's updated time.
func (r *PocketBaseConversationRepo) SetConversationUpdated(
	conversationID string,
) error {
	record, err := r.app.Dao().FindRecordById(r.collection.Name, conversationID)
	if err != nil {
		return err
	}
	record.RefreshUpdated()

	return r.app.Dao().Save(record)
}

// ByID returns a conversation by its ID.
func (r *PocketBaseConversationRepo) ByID(id string) (Conversation, error) {
	conversation := Conversation{}

	record, err := r.app.Dao().FindRecordById(r.collection.Name, id)
	if err != nil {
		return conversation, err
	}

	conversation.ID = record.Id

	duration, err := time.ParseDuration(record.GetString("expiry_duration"))
	if err != nil {
		// Explicitly ignore the error as by default there will be no expiry duration
	}
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
	collection, err := app.Dao().FindCollectionByNameOrId("conversations")
	if err != nil {
		panic(err)
	}
	return &PocketBaseConversationRepo{
		app:         app,
		collection:  collection,
		keyPairRepo: keyPairRepo,
	}
}
