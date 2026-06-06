package main

import (
	"crypto/rand"
	"encoding/base64"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/secretbox"
	"golang.org/x/term"
)

func main() {
	// Read the user email and vault password from the CLI
	// TODO(ewan): Change this to use a UserID instead
	userEmail := flag.String(
		"email",
		"",
		"User email address (used as a salt for the vault password hash)",
	)
	flag.Parse()

	if *userEmail == "" {
		log.Fatal("User email is required")
	}

	fmt.Fprint(os.Stderr, "Vault password: ")
	passwordBytes, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		log.Fatal(err)
	}

	vaultPassword := strings.TrimSpace(string(passwordBytes))
	if vaultPassword == "" {
		log.Fatal("Vault password is required")
	}

	// Hash the vault password with Argon2id
	// Using OWASP recommendations for Argon2id
	// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
	hashedPassword := argon2.IDKey(
		[]byte(vaultPassword),
		[]byte(*userEmail),
		2,
		19*1024,
		1,
		32,
	)
	var vaultPasswordKey [32]byte
	copy(vaultPasswordKey[:], hashedPassword)

	// Generate a new key pair
	pubKeyBytes, secKeyBytes, err := box.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatal(err)
	}

	// Generate a nonce
	var nonce [24]byte
	if _, err := io.ReadFull(rand.Reader, nonce[:]); err != nil {
		panic(err)
	}

	// Encrypt the secret key with the hashed vault password
	encryptedSecKeyBytes := secretbox.Seal(
		nonce[:],
		secKeyBytes[:],
		&nonce,
		&vaultPasswordKey,
	)

	// Encode the public key and encrypted secret key as base64 strings
	pubKeyString := base64.StdEncoding.EncodeToString(pubKeyBytes[:])
	encryptedSecKeyString := base64.StdEncoding.EncodeToString(encryptedSecKeyBytes)

	// Print the public key and encrypted secret key
	log.Printf("Public Key: %s\n", pubKeyString)
	log.Printf("Encrypted Secret Key: %s\n", encryptedSecKeyString)
}
