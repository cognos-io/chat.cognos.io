package main

import (
	"crypto/rand"
	"encoding/base64"
	"flag"
	"fmt"
	"io"
	"log"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/secretbox"
)

const accountKeyBytes = 16

func main() {
	accountKey := flag.String(
		"account-key",
		"",
		"Account Key. If omitted, a new one is generated and printed",
	)
	flag.Parse()

	resolvedAccountKey := normalizeAccountKey(*accountKey)
	if resolvedAccountKey == "" {
		generatedAccountKey, err := generateAccountKey()
		if err != nil {
			log.Fatal(err)
		}
		resolvedAccountKey = normalizeAccountKey(generatedAccountKey)
		log.Printf("Account Key: %s\n", generatedAccountKey)
	} else {
		log.Printf("Account Key: %s\n", formatAccountKey(resolvedAccountKey))
	}

	passwordSalt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, passwordSalt); err != nil {
		log.Fatal(err)
	}

	// account_key_v2: the unlock key derives from the Account Key alone.
	secretMaterial := []byte(resolvedAccountKey)
	hashedPassword := argon2.IDKey(
		secretMaterial,
		passwordSalt,
		2,
		19*1024,
		1,
		32,
	)
	var unlockKey [32]byte
	copy(unlockKey[:], hashedPassword)

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
		&unlockKey,
	)

	pubKeyString := base64.StdEncoding.EncodeToString(pubKeyBytes[:])
	encryptedSecKeyString := base64.StdEncoding.EncodeToString(encryptedSecKeyBytes)
	passwordSaltString := base64.StdEncoding.EncodeToString(passwordSalt)

	log.Printf("Unlock Scheme: account_key_v2\n")
	log.Printf("Password Salt: %s\n", passwordSaltString)
	log.Printf("Public Key: %s\n", pubKeyString)
	log.Printf("Encrypted Secret Key: %s\n", encryptedSecKeyString)
}

func generateAccountKey() (string, error) {
	buf := make([]byte, accountKeyBytes)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", err
	}

	parts := make([]string, 0, len(buf)/2)
	for i := 0; i+1 < len(buf); i += 2 {
		parts = append(parts, fmt.Sprintf("%02X%02X", buf[i], buf[i+1]))
	}

	return strings.Join(parts, "-"), nil
}

func normalizeAccountKey(accountKey string) string {
	return strings.ToUpper(strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r - 32
		case r >= 'A' && r <= 'Z':
			return r
		case r >= '0' && r <= '9':
			return r
		default:
			return -1
		}
	}, accountKey))
}

func formatAccountKey(accountKey string) string {
	groups := make([]string, 0, len(accountKey)/4)
	for i := 0; i < len(accountKey); i += 4 {
		end := min(i+4, len(accountKey))
		groups = append(groups, accountKey[i:end])
	}

	return strings.Join(groups, "-")
}
