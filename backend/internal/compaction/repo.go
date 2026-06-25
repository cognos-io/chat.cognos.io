package compaction

import (
	"encoding/base64"
	"encoding/json"

	"github.com/cognos-io/chat.cognos.io/backend/internal/crypto"
	"github.com/pocketbase/pocketbase/core"
)

const collectionName = "conversation_compactions"

// EncryptPayload seals a compaction payload to the conversation public key,
// returning base64(SealAnonymous(publicKey, json)). Mirrors message encryption:
// the server can write it but never read it back without the conversation key.
func EncryptPayload(payload Payload, conversationPublicKey [32]byte) (string, error) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	ciphertext, err := crypto.AsymmetricEncrypt(conversationPublicKey, payloadBytes)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Repo persists and lists encrypted compaction records. It deliberately exposes
// only ciphertext + the conversation relation — no plaintext payload field ever
// touches the database.
type Repo interface {
	Create(conversationID string, conversationPublicKey [32]byte, payload Payload) (*core.Record, error)
	ListByConversation(conversationID string) ([]*core.Record, error)
	ByID(id string) (*core.Record, error)
	Delete(id string) error
}

type PocketBaseRepo struct {
	app        core.App
	collection *core.Collection
}

func NewPocketBaseRepo(app core.App) *PocketBaseRepo {
	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		panic(err)
	}
	return &PocketBaseRepo{app: app, collection: collection}
}

// Create encrypts and persists a compaction. Returns the created record (only
// id/conversation/data/created/updated are populated; everything else is inside
// the ciphertext).
func (r *PocketBaseRepo) Create(
	conversationID string,
	conversationPublicKey [32]byte,
	payload Payload,
) (*core.Record, error) {
	data, err := EncryptPayload(payload, conversationPublicKey)
	if err != nil {
		return nil, err
	}

	record := core.NewRecord(r.collection)
	record.Set("conversation", conversationID)
	record.Set("data", data)
	if err := r.app.Save(record); err != nil {
		return nil, err
	}
	return record, nil
}

// ListByConversation returns all compaction records for a conversation, oldest
// first. The client decrypts and orders them by anchor/level.
func (r *PocketBaseRepo) ListByConversation(conversationID string) ([]*core.Record, error) {
	return r.app.FindRecordsByFilter(
		collectionName,
		"conversation = {:conversation}",
		"created",
		0,
		0,
		map[string]any{"conversation": conversationID},
	)
}

// ByID returns a single compaction record.
func (r *PocketBaseRepo) ByID(id string) (*core.Record, error) {
	return r.app.FindRecordById(collectionName, id)
}

// Delete removes a compaction record (used when a covered message is deleted or
// re-redacted, invalidating the summary — spec §12).
func (r *PocketBaseRepo) Delete(id string) error {
	record, err := r.app.FindRecordById(collectionName, id)
	if err != nil {
		return err
	}
	return r.app.Delete(record)
}
