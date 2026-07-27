package main

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// Under account_key_v2 the email is authentication-only metadata — it is not
// part of any key derivation — so changing it is crypto-safe. The verified
// request → confirm flow is enabled; only unverified direct PATCHes stay blocked.

func TestUserEmailChangeRequestSucceeds(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:   "user email change request is accepted",
		Method: http.MethodPost,
		URL:    "/api/collections/users/request-email-change",
		Body: strings.NewReader(`{
			"newEmail": "test1-new@example.com"
		}`),
		ExpectedStatus: http.StatusNoContent,
		ExpectedEvents: map[string]int{
			"OnMailerRecordEmailChangeSend":     1,
			"OnRecordRequestEmailChangeRequest": 1,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestUserEmailChangeConfirmChangesEmail(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users) error = %v", err)
	}

	const newEmail = "test1-new@example.com"
	token, err := record.NewEmailChangeToken(newEmail)
	if err != nil {
		t.Fatalf("NewEmailChangeToken() error = %v", err)
	}

	scenario := tests.ApiScenario{
		Name:   "user email change confirm updates the email",
		Method: http.MethodPost,
		URL:    "/api/collections/users/confirm-email-change",
		Body: strings.NewReader(fmt.Sprintf(`{
			"token": %q,
			"password": "password-1234"
		}`, token)),
		ExpectedStatus:        http.StatusNoContent,
		DisableTestAppCleanup: true,
		TestAppFactory: func(testing.TB) *tests.TestApp {
			return app
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindAuthRecordByEmail("users", newEmail); err != nil {
				t.Fatalf("expected email to be changed to %q: %v", newEmail, err)
			}
		},
	}

	scenario.Test(t)
}

func TestOAuthOnlyEmailChangeRequestIsNeutrallySuppressed(t *testing.T) {
	app := setupTestApp(t)
	t.Cleanup(app.Cleanup)

	record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users) error = %v", err)
	}
	record.Set("has_cognos_password", false)
	record.SetRandomPassword()
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(OAuth-only user) error = %v", err)
	}

	scenario := tests.ApiScenario{
		Name:   "OAuth-only email change request has neutral response without email",
		Method: http.MethodPost,
		URL:    "/api/collections/users/request-email-change",
		Body: strings.NewReader(`{
			"newEmail": "test1-new@example.com"
		}`),
		ExpectedStatus:        http.StatusNoContent,
		DisableTestAppCleanup: true,
		TestAppFactory: func(testing.TB) *tests.TestApp {
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if got, want := app.TestMailer.TotalSend(), 0; got != want {
				t.Errorf("TestMailer.TotalSend() = %d, want %d", got, want)
			}
		},
	}
	scenario.Test(t)
}
