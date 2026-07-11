package main

import (
	"crypto/rand"
	"encoding/base64"
	"io"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"

	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
)

// testMFAKeyB64 is a deterministic 32-byte base64 key used across MFA tests so
// the test app's seed cipher matches the one tests use to seal seeds.
var testMFAKeyB64 = base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))

const testUserEmail = "test1@example.com"

// testMFACipher returns a cipher keyed identically to the test app.
func testMFACipher(t *testing.T) *mfa.SeedCipher {
	t.Helper()
	cipher, err := mfa.NewSeedCipher(testMFAKeyB64)
	if err != nil {
		t.Fatalf("test seed cipher: %v", err)
	}
	return cipher
}

// enrollVerifiedTOTP seeds an active (verified) TOTP credential for the seed
// user and flips mfa_enabled. It returns the base32 secret so the test can
// generate valid codes.
func enrollVerifiedTOTP(t *testing.T, app *tests.TestApp) (userID, secret string) {
	t.Helper()

	key, err := mfa.GenerateSecret("Cognos", testUserEmail)
	if err != nil {
		t.Fatalf("generate secret: %v", err)
	}
	secret = key.Secret()
	return enrollVerifiedTOTPSecret(t, app, secret), secret
}

func enrollVerifiedTOTPSecret(t *testing.T, app *tests.TestApp, secret string) string {
	t.Helper()

	user, err := app.FindAuthRecordByEmail("users", testUserEmail)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}

	cipher := testMFACipher(t)
	ct, nonce, err := cipher.Seal([]byte(secret))
	if err != nil {
		t.Fatalf("seal seed: %v", err)
	}

	totpColl, err := app.FindCollectionByNameOrId("user_mfa_totp")
	if err != nil {
		t.Fatalf("find user_mfa_totp: %v", err)
	}
	record := core.NewRecord(totpColl)
	record.Set("user", user.Id)
	record.Set("secret_ciphertext", ct)
	record.Set("secret_nonce", nonce)
	record.Set("secret_key_id", cipher.KeyID())
	record.Set("algorithm", mfa.DefaultAlgorithm)
	record.Set("digits", mfa.DefaultDigits)
	record.Set("period_seconds", mfa.DefaultPeriod)
	record.Set("verified_at", types.NowDateTime())
	if err := app.Save(record); err != nil {
		t.Fatalf("save totp: %v", err)
	}

	user.Set("mfa_enabled", true)
	user.Set("mfa_enrolled_at", types.NowDateTime())
	if err := app.Save(user); err != nil {
		t.Fatalf("enable mfa: %v", err)
	}

	return user.Id
}

// enrollPendingTOTP seeds an UNVERIFIED TOTP credential (as MFAEnrolTOTP would)
// without enabling MFA, returning the base32 secret for code generation.
func enrollPendingTOTP(t *testing.T, app *tests.TestApp) (userID, secret string) {
	t.Helper()

	user, err := app.FindAuthRecordByEmail("users", testUserEmail)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}

	key, err := mfa.GenerateSecret("Cognos", testUserEmail)
	if err != nil {
		t.Fatalf("generate secret: %v", err)
	}

	cipher := testMFACipher(t)
	ct, nonce, err := cipher.Seal([]byte(key.Secret()))
	if err != nil {
		t.Fatalf("seal seed: %v", err)
	}
	if _, err := mfa.NewStore(app).UpsertEnrolment(user.Id, ct, nonce, cipher.KeyID()); err != nil {
		t.Fatalf("upsert enrolment: %v", err)
	}
	return user.Id, key.Secret()
}

// openSession creates an MFA auth session and returns the raw token.
func openSession(t *testing.T, app *tests.TestApp, userID string) string {
	t.Helper()
	raw, err := mfa.NewStore(app).CreateAuthSession(userID)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	return raw
}

// totpCodeNow generates a valid code for the secret at the current time.
func totpCodeNow(t *testing.T, secret string) string {
	t.Helper()
	code, err := totp.GenerateCodeCustom(secret, time.Now(), totp.ValidateOpts{
		Period:    mfa.DefaultPeriod,
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	if err != nil {
		t.Fatalf("generate code: %v", err)
	}
	return code
}

// seedRecoveryCodes stores recovery codes for a user and returns the plaintext.
func seedRecoveryCodes(t *testing.T, app *tests.TestApp, userID string) []string {
	t.Helper()
	plain, hashes := mfa.GenerateRecoveryCodes(mfa.RecoveryCodeCount)
	if err := mfa.NewStore(app).ReplaceRecoveryCodes(userID, hashes); err != nil {
		t.Fatalf("seed recovery codes: %v", err)
	}
	return plain
}

// futureDateTime returns a DateTime 15 minutes in the future (for seeding locks).
func futureDateTime() types.DateTime {
	return types.NowDateTime().Add(15 * time.Minute)
}

// randomKeyB64 returns a fresh 32-byte base64 key (for negative cipher tests).
func randomKeyB64(t *testing.T) string {
	t.Helper()
	raw := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return base64.StdEncoding.EncodeToString(raw)
}
