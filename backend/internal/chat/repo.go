package chat

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/crypto"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/forms"
	"github.com/pocketbase/pocketbase/models"
	"github.com/pocketbase/pocketbase/tools/list"
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
		conversation Conversation,
		parentMessageID string,
		message MessageRecordData,
	) (error, *models.Record)
	DeleteMessage(messageID string) error
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
	conversation Conversation,
	parentMessageID string,
	message MessageRecordData,
) (error, *models.Record) {
	base64EncryptedMessage, err := EncryptMessageData(
		message,
		conversation.PublicKey,
	)
	if err != nil {
		return err, nil
	}

	formData := map[string]any{
		"data":           base64EncryptedMessage,
		"conversation":   conversation.ID,
		"parent_message": parentMessageID,
	}

	if conversation.ExpiryDuration != 0 {
		formData["expires"] = time.Now().UTC().Add(conversation.ExpiryDuration)
	}

	record := models.NewRecord(r.collection)
	form := forms.NewRecordUpsert(r.app, record)
	err = form.LoadData(formData)
	if err != nil {
		return err, nil
	}

	return form.Submit(), record
}

// DeleteMessage deletes a message from the repository.
func (r *PocketBaseMessageRepo) DeleteMessage(messageID string) error {
	record, err := r.app.Dao().FindRecordById(r.collection.Name, messageID)
	if err != nil {
		return err
	}

	return r.app.Dao().DeleteRecord(record)
}

func (r *PocketBaseMessageRepo) FindExpiredMessages() ([]string, error) {
	now := time.Now().UTC()
	filter := dbx.And(
		dbx.Not(
			dbx.NewExp("expires = ''"),
		),
		dbx.NewExp("expires < {:now}", dbx.Params{"now": now}),
	)

	messageResults := []struct {
		Id string `db:"id" json:"id"`
	}{}

	err := r.app.Dao().
		DB().
		Select("id").
		From(r.collection.Name).
		AndWhere(filter).
		All(&messageResults)

	messageIds := make([]string, len(messageResults))
	for i, result := range messageResults {
		messageIds[i] = result.Id
	}

	return messageIds, err
}

func (r *PocketBaseMessageRepo) CleanUpExpiredMessages(
	messageIDs []string,
) (sql.Result, error) {
	return r.app.Dao().
		DB().
		Delete(r.collection.Name, dbx.In("id", list.ToInterfaceSlice[string](messageIDs)...)).
		Execute()
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
