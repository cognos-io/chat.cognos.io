package main

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// Password reset is allowed under the account_key_v2 scheme: the password is
// authentication-only, so resetting it never affects encrypted data.

func TestPasswordResetRequestIsAllowed(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:   "password reset request is accepted",
		Method: http.MethodPost,
		URL:    "/api/collections/users/request-password-reset",
		Body: strings.NewReader(`{
			"email": "test1@example.com"
		}`),
		// PocketBase returns 204 and (in tests) captures the email rather than
		// sending it. The point is that our hook no longer rejects the request.
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
	}

	scenario.Test(t)
}

func TestPasswordResetConfirmChangesPassword(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users) error = %v", err)
	}

	token, err := record.NewPasswordResetToken()
	if err != nil {
		t.Fatalf("NewPasswordResetToken() error = %v", err)
	}

	const newPassword = "a-brand-new-password"

	scenario := tests.ApiScenario{
		Name:   "password reset confirm changes the password",
		Method: http.MethodPost,
		URL:    "/api/collections/users/confirm-password-reset",
		Body: strings.NewReader(fmt.Sprintf(`{
			"token": %q,
			"password": %q,
			"passwordConfirm": %q
		}`, token, newPassword, newPassword)),
		ExpectedStatus:        http.StatusNoContent,
		DisableTestAppCleanup: true,
		TestAppFactory: func(testing.TB) *tests.TestApp {
			return app
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			updated, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(users) error = %v", err)
			}
			if !updated.ValidatePassword(newPassword) {
				t.Fatal("password was not updated by the reset confirmation")
			}
		},
	}

	scenario.Test(t)
}
