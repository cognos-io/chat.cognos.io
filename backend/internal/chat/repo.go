package chat

import (
	"encoding/base64"
	"encoding/json"

	"github.com/cognos-io/chat.cognos.io/backend/internal/crypto"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/forms"
	"github.com/pocketbase/pocketbase/models"
)

// EncryptMessageData encrypts a plain text message using symmetric and asymmetric encryption.
// It takes the plain text message and the receiver's public key as input parameters.
// The function returns the base64 encoded encrypted message and the base64 encoded encrypted symmetric key.
// If an error occurs during the encryption process, it returns an empty string and the error.
func EncryptMessageData(
	message MessageRecordData,
	receiverPublicKey [32]byte,
) (base64EncryptedMessage string, err error) {
	// Turn our message into bytes of the JSON representation
	messageBytes, err := json.Marshal(message)
	if err != nil {
		return
	}

	// This is essentially a NaCl sealed box which includes the ephemeral public key
	cipherText, err := crypto.AsymmetricEncrypt(
		receiverPublicKey,
		messageBytes,
	)
	if err != nil {
		return
	}

	// Return the base64 encoded encrypted message
	base64EncryptedMessage = base64.StdEncoding.EncodeToString(cipherText)
	return
}

type MessageRepo interface {
	EncryptAndPersistMessage(
		receiverPublicKey [32]byte,
		conversationID string,
		parentMessageID string,
		message MessageRecordData,
	) (error, *models.Record)
}

type PocketBaseMessageRepo struct {
	app        core.App
	collection *models.Collection
}

// EncryptAndPersistMessage persists a message in the repository.
// It takes the receiver's public key and the plain text message as parameters.
// The receiver public key can be a conversation key or a user's public key.
// Returns an error if there was a problem persisting the message.
func (r *PocketBaseMessageRepo) EncryptAndPersistMessage(
	receiverPublicKey [32]byte,
	conversationID string,
	parentMessageID string,
	message MessageRecordData,
) (error, *models.Record) {
	base64EncryptedMessage, err := EncryptMessageData(
		message,
		receiverPublicKey,
	)
	if err != nil {
		return err, nil
	}
	record := models.NewRecord(r.collection)
	form := forms.NewRecordUpsert(r.app, record)
	err = form.LoadData(map[string]any{
		"data":           base64EncryptedMessage,
		"conversation":   conversationID,
		"parent_message": parentMessageID,
	})
	if err != nil {
		return err, nil
	}

	return form.Submit(), record
}

func NewPocketBaseMessageRepo(app core.App) *PocketBaseMessageRepo {
	collection, err := app.Dao().FindCollectionByNameOrId("messages")
	if err != nil {
		panic(err)
	}
	return &PocketBaseMessageRepo{
		app:        app,
		collection: collection,
	}
}
