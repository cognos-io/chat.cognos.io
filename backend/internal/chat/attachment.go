package chat

import (
	"encoding/base64"

	"github.com/cognos-io/chat.cognos.io/backend/internal/crypto"
)

// EncryptedAttachment is the result of encrypting generated attachment bytes
// (e.g. an image) for a conversation.
type EncryptedAttachment struct {
	// Ciphertext is the symmetrically-encrypted attachment bytes, written to the
	// protected file store. It is `nonce || secretbox` (see crypto.SymmetricEncrypt).
	Ciphertext []byte
	// SealedKeyB64 is the per-attachment symmetric key sealed to the conversation
	// public key with an anonymous box, base64-encoded. It is embedded in the
	// encrypted assistant message payload, never stored in a plaintext column.
	SealedKeyB64 string
}

// EncryptAttachment encrypts attachment bytes for a conversation, reusing the
// exact scheme used for messages: the bytes are sealed under a random symmetric
// key, and that key is sealed to the conversation public key with an anonymous
// box (crypto.AsymmetricEncrypt). The server can encrypt but never decrypt; only
// a holder of the conversation secret key can recover the attachment.
//
// Sealing only the small symmetric key (rather than the large image) to the
// conversation key keeps the heavy ciphertext as a single secretbox blob while
// staying consistent with EncryptMessageData.
func EncryptAttachment(
	plaintext []byte,
	conversationPublicKey [32]byte,
) (EncryptedAttachment, error) {
	symmetricKey, ciphertext, err := crypto.SymmetricEncrypt(plaintext)
	if err != nil {
		return EncryptedAttachment{}, err
	}

	sealedKey, err := crypto.AsymmetricEncrypt(conversationPublicKey, symmetricKey[:])
	if err != nil {
		return EncryptedAttachment{}, err
	}

	return EncryptedAttachment{
		Ciphertext:   ciphertext,
		SealedKeyB64: base64.StdEncoding.EncodeToString(sealedKey),
	}, nil
}
