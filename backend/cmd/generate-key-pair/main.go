package main

import (
	"crypto/rand"
	"encoding/base64"
	"flag"
	"io"
	"log"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/secretbox"
)

func main() {
	vaultPassword := flag.String(
		"password",
		"",
		"Vault password. Hashed and used to encrypt the secret key",
	)
	flag.Parse()

	if *vaultPassword == "" {
		log.Fatal("Vault password is required")
	}

	passwordSalt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, passwordSalt); err != nil {
		log.Fatal(err)
	}

	hashedPassword := argon2.IDKey(
		[]byte(*vaultPassword),
		passwordSalt,
		2,
		19*1024,
		1,
		32,
	)
	var vaultPasswordKey [32]byte
	copy(vaultPasswordKey[:], hashedPassword)

	pubKeyBytes, secKeyBytes, err := box.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatal(err)
	}

	var nonce [24]byte
	if _, err := io.ReadFull(rand.Reader, nonce[:]); err != nil {
		panic(err)
	}

	encryptedSecKeyBytes := secretbox.Seal(
		nonce[:],
		secKeyBytes[:],
		&nonce,
		&vaultPasswordKey,
	)

	pubKeyString := base64.StdEncoding.EncodeToString(pubKeyBytes[:])
	encryptedSecKeyString := base64.StdEncoding.EncodeToString(encryptedSecKeyBytes)
	passwordSaltString := base64.StdEncoding.EncodeToString(passwordSalt)

	log.Printf("Password Salt: %s\n", passwordSaltString)
	log.Printf("Public Key: %s\n", pubKeyString)
	log.Printf("Encrypted Secret Key: %s\n", encryptedSecKeyString)
}
