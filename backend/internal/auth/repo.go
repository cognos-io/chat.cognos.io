package auth

import (
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

var (
	ErrNoKeyPair                   = errors.New("no key pair found")
	ErrMultipleConversationKeyPair = errors.New("multiple conversation key pairs found")
	ErrMultipleUserKeyPair         = errors.New("multiple user key pairs found")
)

type KeyPair struct {
	ID        string `db:"id"`
	PublicKey string `db:"public_key"`
	SecretKey string `db:"secret_key"`
}

type KeyPairRepo interface {
	ConversationPublicKey(conversationID string) ([32]byte, error)
	UserPublicKey(userID string) ([32]byte, error)
}

type PocketBaseKeyPairRepo struct {
	app core.App
}

// ConversationPublicKey returns the public key for the given conversation.
func (r *PocketBaseKeyPairRepo) ConversationPublicKey(
	conversationID string,
) ([32]byte, error) {
	const collectionName = "conversation_public_keys"

	records, err := r.app.FindRecordsByFilter(collectionName,
		"conversation = {:conversation_id}", // filter
		"",                                  // sort
		2,                                   // limit
		0,                                   // offset
		dbx.Params{"conversation_id": conversationID}, // params
	)
	if err != nil {
		return [32]byte{}, err
	}

	if len(records) == 0 {
		return [32]byte{}, ErrNoKeyPair
	}
	if len(records) > 1 {
		return [32]byte{}, ErrMultipleConversationKeyPair
	}

	key_pair := records[0]
	public_key := key_pair.GetString("public_key")

	public_key_slice, err := base64.StdEncoding.DecodeString(public_key)
	if err != nil {
		return [32]byte{}, err
	}
	if len(public_key_slice) != 32 {
		return [32]byte{}, fmt.Errorf("invalid conversation public key length: %d", len(public_key_slice))
	}

	var public_key_bytes [32]byte
	copy(public_key_bytes[:], public_key_slice)

	return public_key_bytes, nil
}

// UserPublicKey returns the public key for the given user.
func (r *PocketBaseKeyPairRepo) UserPublicKey(userID string) ([32]byte, error) {
	const collectionName = "user_key_pairs"

	records, err := r.app.FindRecordsByFilter(collectionName,
		"user = {:user_id}",           // filter
		"",                            // sort
		2,                             // limit
		0,                             // offset
		dbx.Params{"user_id": userID}, // params
	)
	if err != nil {
		return [32]byte{}, err
	}

	if len(records) == 0 {
		return [32]byte{}, ErrNoKeyPair
	}
	if len(records) > 1 {
		return [32]byte{}, ErrMultipleUserKeyPair
	}

	key_pair := records[0]
	public_key := key_pair.GetString("public_key")

	public_key_slice, err := base64.StdEncoding.DecodeString(public_key)
	if err != nil {
		return [32]byte{}, err
	}
	if len(public_key_slice) != 32 {
		return [32]byte{}, fmt.Errorf("invalid user public key length: %d", len(public_key_slice))
	}

	var public_key_bytes [32]byte
	copy(public_key_bytes[:], public_key_slice)

	return public_key_bytes, nil
}

func NewPocketBaseKeyPairRepo(app core.App) *PocketBaseKeyPairRepo {
	return &PocketBaseKeyPairRepo{app: app}
}
