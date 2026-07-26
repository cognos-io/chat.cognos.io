/*
  - These tests check the API rules and filters for the PocketBase collections.
  - To ensure proper rule coverage, we should ensure we're checking the following:
  - - List/Search
  - - View
  - - Create
  - - Update
  - - Delete
    *
  - For each of these operations we should check the following:
  - - As a guest (non-authenticated user)
  - - As a user with a record token
  - - As a user with a record token trying to access another users data
    *
  - That means each collection should have at least 15 tests.
    *

- Useful reference: https://github.com/presentator/presentator/blob/7200691263d5438d167118e1d013e2ac2de7390e/api_users_test.go
*/
package main

import (
	"crypto/rand"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"golang.org/x/crypto/argon2"
)

const testDataDir = "../../testdata/seed"

var testUsers = []struct {
	ID               string
	Email            string
	Username         string
	Password         string
	PrivacyTier      string
	PreferredModelID string
	Verified         bool
}{
	{
		ID:          "uvi8zmr78j9y5hz",
		Email:       "test1@example.com",
		Username:    "test1",
		Password:    "password-1234",
		PrivacyTier: "eu",
		Verified:    true,
	},
	{
		ID:          "xq9ndvc2kbrvrng",
		Email:       "test2@example.com",
		Username:    "test2",
		Password:    "password-1234",
		PrivacyTier: "eu",
		Verified:    true,
	},
	{
		ID:          "j8prcx3dum2l3kc",
		Email:       "no_data@example.com",
		Username:    "no-data",
		Password:    "password-1234",
		PrivacyTier: "eu",
		Verified:    true,
	},
	// Deliberately unverified: pins the EMAIL_NOT_VERIFIED gate on the
	// AI-consuming endpoints (see email_verification_test.go).
	{
		ID:          "unverifieduser1",
		Email:       "unverified@example.com",
		Username:    "unverified",
		Password:    "password-1234",
		PrivacyTier: "eu",
		Verified:    false,
	},
}

var testUserKeyPairs = []struct {
	ID           string
	UserID       string
	PublicKey    string
	SecretKey    string
	PasswordSalt string
	UnlockScheme string
	RecordMAC    string
}{
	{
		ID:        "3gtr36mn54ldo53",
		UserID:    "uvi8zmr78j9y5hz",
		PublicKey: "FaTq77hDYWu9pNLMwBlQ4Ks54BAfwz1Y7/nmyZTLkTE=",
		SecretKey: strings.Join([]string{
			"xi1EQyn4P+UgOuMK",
			"CL3RPtUEMZ43VnHT",
			"6XVxH++Dw0Y+OH+g",
			"ihK/axp4sR7jxWWQ",
			"zs0BIrq1L77tem6K",
			"SZaJGqFNjtjTt89x",
		}, ""),
		PasswordSalt: "AAAAAAAAAAAAAAAAAAAAAA==",
		UnlockScheme: "account_key_v2",
		RecordMAC:    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
	},
	{
		ID:        "nekxd2byk1j1cof",
		UserID:    "xq9ndvc2kbrvrng",
		PublicKey: "O0juXdZBDWNKqMQrShgh7wUyijMUwboM0a7hJyQvXhU=",
		SecretKey: strings.Join([]string{
			"xLWVkHakuYt4QhUI",
			"OdWznCX4VH+9n+xm",
			"lHmBnjr8Ef6eakIX",
			"Hj0fdHIoLLoJZS+p",
			"cGY74Wzgbrmy1XWa",
			"cqBWHCSpO4/UNT6Z",
		}, ""),
		PasswordSalt: "AAAAAAAAAAAAAAAAAAAAAA==",
		UnlockScheme: "account_key_v2",
		RecordMAC:    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
	},
	{
		ID:        "auylg0nr6ey77ex",
		UserID:    "j8prcx3dum2l3kc",
		PublicKey: "ylqC6oLD2rHUl0QkaxTlvLoHHIKp8AK42qd7jlaHqhQ=",
		SecretKey: strings.Join([]string{
			"vrS5BEQaboI26xYI",
			"7xvc6koppYWWL3aO",
			"MtUrmUEMAly/bDjp",
			"crwL35AwxKZWQUVQ",
			"n5hXvp9aLUiKl14k",
			"eLgnpDUIYL2l38oW",
		}, ""),
		PasswordSalt: "AAAAAAAAAAAAAAAAAAAAAA==",
		UnlockScheme: "account_key_v2",
		RecordMAC:    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
	},
}

func withRecordAuth(
	collectionNameOrId string,
	email string,
) func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
	return func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		record, err := app.FindAuthRecordByEmail(collectionNameOrId, email)
		if err != nil {
			t.Fatal(err)
		}

		e.Router.BindFunc(func(re *core.RequestEvent) error {
			re.Auth = record
			return re.Next()
		})
	}
}

func setupTestApp(t testing.TB) *tests.TestApp {
	return setupTestAppWithHookParams(t, appHookParams{})
}

func setupTestAppWithHookParams(t testing.TB, params appHookParams) *tests.TestApp {
	// The per-process rate-limiter accumulates across all tests in the
	// binary. Once the suite grows past the burst budget, previously-
	// independent tests start tripping each other with 429s. Clearing
	// state per test keeps each one running against a fresh bucket.
	resetRouteRateLimiters()

	app, err := tests.NewTestApp(testDataDir)
	if err != nil {
		t.Fatal(err)
	}

	testConfig := config.APIConfig{
		InfomaniakAPIKey:    "test-infomaniak-key",
		InfomaniakProductID: "test-product-id",
		RequestyAPIKey:      "test-requesty-key",
		// A fixed 32-byte (base64) key so MFA TOTP enrolment/verification works in
		// tests. testMFAKeyB64 is defined in mfa_test_helpers.go.
		MFATOTPEncryptionKey: testMFAKeyB64,
	}
	params.App = app
	if params.Config == nil {
		params.Config = &testConfig
	}
	if params.FXRateProvider == nil {
		params.FXRateProvider = billing.StaticFXRateProvider{Rate: 1}
	}

	bindAppHooks(params)
	seedTestData(t, app)

	return app
}

func seedTestData(t testing.TB, app *tests.TestApp) {
	t.Helper()

	usersCollection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(users) error = %v", err)
	}

	for _, seed := range testUsers {
		record := core.NewRecord(usersCollection)
		record.Id = seed.ID
		record.Set("email", seed.Email)
		record.Set("username", seed.Username)
		record.Set("verified", seed.Verified)
		record.Set("privacy_tier", seed.PrivacyTier)
		record.Set("preferred_model_id", seed.PreferredModelID)
		record.Set("has_cognos_password", true)
		record.SetPassword(seed.Password)
		if err := app.Save(record); err != nil {
			t.Fatalf("Save(users %q) error = %v", seed.Email, err)
		}
	}

	userKeyPairsCollection, err := app.FindCollectionByNameOrId("user_key_pairs")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(user_key_pairs) error = %v", err)
	}

	for _, seed := range testUserKeyPairs {
		record := core.NewRecord(userKeyPairsCollection)
		record.Id = seed.ID
		record.Set("user", seed.UserID)
		record.Set("public_key", seed.PublicKey)
		record.Set("secret_key", seed.SecretKey)
		record.Set("password_salt", seed.PasswordSalt)
		record.Set("unlock_scheme", seed.UnlockScheme)
		record.Set("record_mac", seed.RecordMAC)
		if err := app.Save(record); err != nil {
			t.Fatalf("Save(user_key_pairs %q) error = %v", seed.ID, err)
		}
	}
}

func hashVaultPassword(vaultPassword, userEmail string) [32]byte {
	hashedPassword := argon2.IDKey(
		[]byte(vaultPassword),
		[]byte(userEmail),
		2, 19*1024, 1,
		32,
	)
	var vaultPasswordKey [32]byte
	copy(vaultPasswordKey[:], hashedPassword)

	return vaultPasswordKey
}

func generateNonce() [24]byte {
	// Generate a nonce
	var nonce [24]byte
	if _, err := io.ReadFull(rand.Reader, nonce[:]); err != nil {
		panic(err)
	}
	return nonce
}

// TestConversationFilterRules used to assert that /api/collections/
// conversations/records returned an empty list to guests and authed
// users. After migration 1760000020 locked the chat-collection rules
// entirely, that surface returns 403 regardless of caller — covered in
// far more detail by TestConversationsCollectionRoutesLocked et al. in
// collection_rules_participants_test.go. The function lives on as a
// breadcrumb so a future reader looking up "ConversationFilterRules"
// finds the replacement.
func TestConversationFilterRules(t *testing.T) {
	t.Skip("see TestConversationsCollectionRoutesLocked — chat collections are now fully locked")
}

func TestUserKeyPairFilterRules(t *testing.T) {
	t.Parallel()

	const (
		collectionName = "user_key_pairs"
		// Seeded by setupTestApp.
		userEmail              = "test1@example.com"
		userId                 = "uvi8zmr78j9y5hz"
		userPublicKey          = "FaTq77hDYWu9pNLMwBlQ4Ks54BAfwz1Y7/nmyZTLkTE="
		userEncryptedSecretKey = "xi1EQyn4P+UgOuMKCL3RPtUEMZ43VnHT6XVxH++Dw0Y+OH+gihK/axp4sR7jxWWQzs0BIrq1L77tem6KSZaJGqFNjtjTt89x"
	)

	url := fmt.Sprintf("/api/collections/%s/records", collectionName)
	withUserToken := withRecordAuth("users", userEmail)

	scenarios := []tests.ApiScenario{
		// List/Search
		{
			Name:            "list user key pairs as guest",
			Method:          http.MethodGet,
			URL:             url,
			Headers:         map[string]string{},
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"items":[]`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:            "list user key pairs via user token",
			Method:          http.MethodGet,
			URL:             url,
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"totalItems":1`, `"id":"3gtr36mn54ldo53"`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  withUserToken,
		},
		// View specific record
		{
			Name:            "get user key pair as guest",
			Method:          http.MethodGet,
			URL:             fmt.Sprintf("%s/3gtr36mn54ldo53", url),
			Headers:         map[string]string{},
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:            "get user key pair via user token",
			Method:          http.MethodGet,
			URL:             fmt.Sprintf("%s/3gtr36mn54ldo53", url),
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"id":"3gtr36mn54ldo53"`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  withUserToken,
		},
		{
			Name:            "get another users key pair via user token",
			Method:          http.MethodGet,
			URL:             fmt.Sprintf("%s/nekxd2byk1j1cof", url),
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  withUserToken,
		},
		// Create
		{
			Name:    "create user key pair as guest",
			Method:  http.MethodPost,
			URL:     url,
			Headers: map[string]string{},
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": "%s",
				"public_key": "%s",
				"secret_key": "%s"
			}`, userId, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:   "create duplicate user key pair via user token",
			Method: http.MethodPost,
			URL:    url,
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": "%s",
				"public_key": "%s",
				"secret_key": "%s",
				"password_salt": "AAAAAAAAAAAAAAAAAAAAAA==",
				"unlock_scheme": "account_key_v2",
				"record_mac": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
			}`, userId, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"message":"User key pair already exists."`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  withUserToken,
		},
		{
			Name:   "create user key pair via user token with missing user ID",
			Method: http.MethodPost,
			URL:    url,
			Body: strings.NewReader(fmt.Sprintf(`{
				"public_key": "%s",
				"secret_key": "%s"
			}`, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus: http.StatusBadRequest,
			ExpectedContent: []string{
				`"message":"Failed to create record."`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withUserToken,
		},
		{
			Name:   "create user key pair via user token with invalid keys",
			Method: http.MethodPost,
			URL:    url,
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": "%s",
				"public_key": "im-not-a-valid-key",
				"secret_key": "%s",
				"password_salt": "AAAAAAAAAAAAAAAAAAAAAA==",
				"unlock_scheme": "account_key_v2",
				"record_mac": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
			}`, userId, userEncryptedSecretKey)),
			ExpectedStatus: http.StatusBadRequest,
			ExpectedContent: []string{
				`"message":"User key pair already exists."`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withUserToken,
		},
		{
			Name:   "create another users key pair via user token",
			Method: http.MethodPost,
			URL:    url,
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": "xq9ndvc2kbrvrng",
				"public_key": "%s",
				"secret_key": "%s"
			}`, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  withUserToken,
		},
		{
			Name:   "create a key pair with a fixed ID",
			Method: http.MethodPost,
			URL:    url,
			Body: strings.NewReader(fmt.Sprintf(`{
				"id": "k7prcx11dum2l3k",
				"user": "%s",
				"public_key": "%s",
				"secret_key": "%s"
			}`, userId, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  withUserToken,
		},
		{
			Name:   "create a key pair with a fixed created & modified",
			Method: http.MethodPost,
			URL:    url,
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": "%s",
				"public_key": "%s",
				"secret_key": "%s",
				"created": "2021-01-01T00:00:00Z",
				"modified": "2021-01-01T00:00:00Z"
			}`, userId, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  withUserToken,
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}
