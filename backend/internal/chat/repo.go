package chat

import (
	"encoding/base64"

	"github.com/cognos-io/chat.cognos.io/backend/internal/crypto"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/forms"
	"github.com/pocketbase/pocketbase/models"
)

type PlainTextMessage struct {
	OwnerID        string `json:"owner_id,omitempty"`
	ConversationID string `json:"conversation_id,omitempty"`
	Content        string `json:"content"`
}

// EncryptMessage encrypts a plain text message using symmetric and asymmetric encryption.
// It takes the plain text message and the receiver's public key as input parameters.
// The function returns the base64 encoded encrypted message and the base64 encoded encrypted symmetric key.
// If an error occurs during the encryption process, it returns an empty string and the error.
func EncryptMessage(plainTextMessage string, receiverPublicKey [32]byte) (base64EncryptedMessage, base64EncryptedSymmetricKey string, err error) {
	// Symmetrically encrypt the request message with a random key
	symmetricKey, encryptedMessage, err := crypto.SymmetricEncrypt([]byte(plainTextMessage))
	if err != nil {
		return "", "", err
	}
	// Asymmetrically encrypt the symmetric key with the receiver's public key
	encryptedSymmetricKey, err := crypto.AsymmetricEncrypt(receiverPublicKey, symmetricKey[:])
	if err != nil {
		return "", "", err
	}
	// Return the base64 encoded encrypted message and symmetric key
	base64EncryptedMessage = base64.StdEncoding.EncodeToString(encryptedMessage)
	base64EncryptedSymmetricKey = base64.StdEncoding.EncodeToString(encryptedSymmetricKey)
	return
}

type MessageRepo interface {
	PersistMessage(receiverPublicKey [32]byte, message *PlainTextMessage) error
}

type PocketBaseMessageRepo struct {
	app        core.App
	collection *models.Collection
}

// PersistMessage persists a message in the repository.
// It takes the receiver's public key and the plain text message as parameters.
// The receiver public key can be a conversation key or a user's public key.
// Returns an error if there was a problem persisting the message.
func (r *PocketBaseMessageRepo) PersistMessage(receiverPublicKey [32]byte, message *PlainTextMessage) error {
	record := models.NewRecord(r.collection)
	form := forms.NewRecordUpsert(r.app, record)
	form.LoadData(map[string]any{})

	return form.Submit()
}

func NewPocketBaseMessageRepo(app core.App) (*PocketBaseMessageRepo, error) {
	collection, err := app.Dao().FindCollectionByNameOrId("messages")
	if err != nil {
		return nil, err
	}
	return &PocketBaseMessageRepo{
		app:        app,
		collection: collection,
	}, nil
}
