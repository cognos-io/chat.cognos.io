package main

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestUserKeyPairRulesRequireIntegrityMetadata(t *testing.T) {
	t.Parallel()

	const (
		userID         = "c1tempuserpair1"
		userEmail      = "c1-temp@example.com"
		publicKey      = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
		secretKey      = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
		passwordSalt   = "AAAAAAAAAAAAAAAAAAAAAA=="
		recordMAC      = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
		collectionPath = "/api/collections/user_key_pairs/records"
	)

	withUserToken := func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			t.Fatalf("FindCollectionByNameOrId(users) error = %v", err)
		}

		record := core.NewRecord(users)
		record.Id = userID
		record.Set("email", userEmail)
		record.Set("username", "c1tempuserpair1")
		record.Set("verified", true)
		record.SetPassword("password1234")
		if err := app.Save(record); err != nil {
			t.Fatalf("Save(users) error = %v", err)
		}

		e.Router.BindFunc(func(re *core.RequestEvent) error {
			re.Auth = record
			return re.Next()
		})
	}

	for _, scenario := range []tests.ApiScenario{
		{
			Name:   "create user key pair without password salt",
			Method: http.MethodPost,
			URL:    collectionPath,
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": %q,
				"public_key": %q,
				"secret_key": %q,
				"unlock_scheme": "password_account_key_v1",
				"record_mac": %q
			}`, userID, publicKey, secretKey, recordMAC)),
			ExpectedStatus: http.StatusBadRequest,
			ExpectedContent: []string{
				`"data":{}`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withUserToken,
		},
		{
			Name:   "create user key pair without record mac",
			Method: http.MethodPost,
			URL:    collectionPath,
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": %q,
				"public_key": %q,
				"secret_key": %q,
				"password_salt": %q,
				"unlock_scheme": "password_account_key_v1"
			}`, userID, publicKey, secretKey, passwordSalt)),
			ExpectedStatus: http.StatusBadRequest,
			ExpectedContent: []string{
				`"data":{}`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withUserToken,
		},
		{
			Name:   "create user key pair with invalid unlock scheme",
			Method: http.MethodPost,
			URL:    collectionPath,
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": %q,
				"public_key": %q,
				"secret_key": %q,
				"password_salt": %q,
				"unlock_scheme": "legacy_email_v1",
				"record_mac": %q
			}`, userID, publicKey, secretKey, passwordSalt, recordMAC)),
			ExpectedStatus: http.StatusBadRequest,
			ExpectedContent: []string{
				`"data":{}`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withUserToken,
		},
		{
			Name:   "create user key pair with invalid public key",
			Method: http.MethodPost,
			URL:    collectionPath,
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": %q,
				"public_key": "im-not-a-valid-key",
				"secret_key": %q,
				"password_salt": %q,
				"unlock_scheme": "password_account_key_v1",
				"record_mac": %q
			}`, userID, secretKey, passwordSalt, recordMAC)),
			ExpectedStatus: http.StatusBadRequest,
			ExpectedContent: []string{
				`"data":{"public_key":`,
				`"message":"Must be at least 32 character(s)."`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withUserToken,
		},
	} {
		scenario.Test(t)
	}
}
