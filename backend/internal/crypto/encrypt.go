package crypto

import (
	"crypto/rand"
	"io"

	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/secretbox"
)

// NewNonce returns a new random nonce of 24 bytes.
func NewNonce() ([24]byte, error) {
	var nonce [24]byte
	_, err := io.ReadFull(rand.Reader, nonce[:])
	return nonce, err
}

// NewSymmetricKey returns a new random symmetric key of 32 bytes.
func NewSymmetricKey() ([32]byte, error) {
	var key [32]byte
	_, err := io.ReadFull(rand.Reader, key[:])
	return key, err
}

// AsymmetricEncrypt encrypts the given message using the recipient's public key.
// We don't provide a sender private key here as this will be randomly generated.
// It uses the NaCl box to perform the encryption.
// The ciphertext is returned along with any error that occurred during the encryption process.
func AsymmetricEncrypt(recipientPublicKey [32]byte, message []byte) (ciphertext []byte, err error) {
	// NaCl box uses the nonce and public key to encrypt the message
	// https://pkg.go.dev/golang.org/x/crypto@v0.19.0/nacl/box
	ciphertext, err = box.SealAnonymous([]byte{}, message, &recipientPublicKey, rand.Reader)

	return ciphertext, err
}

// SymmetricEncrypt encrypts the given message using symmetric key encryption.
// It generates a random secret key and nonce, and uses them to encrypt the message
// using NaCl secretbox algorithm.
// The encrypted ciphertext and the generated symmetric key are returned.
// If any error occurs during the encryption process, it is also returned.
func SymmetricEncrypt(message []byte) (symmetricKey [32]byte, ciphertext []byte, err error) {
	// Generate our random secret key
	symmetricKey, err = NewSymmetricKey()
	if err != nil {
		return symmetricKey, nil, err
	}

	// Generate our random nonce
	nonce, err := NewNonce()
	if err != nil {
		return symmetricKey, nil, err
	}

	// NaCl secretbox uses the nonce and secret key to encrypt the message
	// https://pkg.go.dev/golang.org/x/crypto@v0.19.0/nacl/secretbox
	ciphertext = secretbox.Seal(nonce[:], message, &nonce, &symmetricKey)

	return symmetricKey, ciphertext, nil
}
