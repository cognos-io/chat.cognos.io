package main

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestPasswordResetRequestIsRejected(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:   "password reset request is rejected",
		Method: http.MethodPost,
		URL:    "/api/collections/users/request-password-reset",
		Body: strings.NewReader(`{
			"email": "test1@example.com"
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"password reset is unavailable until vault recovery is implemented"`,
		},
		TestAppFactory: setupTestApp,
	}

	scenario.Test(t)
}

func TestPasswordResetConfirmIsRejected(t *testing.T) {
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

	scenario := tests.ApiScenario{
		Name:   "password reset confirm is rejected",
		Method: http.MethodPost,
		URL:    "/api/collections/users/confirm-password-reset",
		Body: strings.NewReader(fmt.Sprintf(`{
			"token": %q,
			"password": "new-password",
			"passwordConfirm": "new-password"
		}`, token)),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"password reset is unavailable until vault recovery is implemented"`,
		},
		DisableTestAppCleanup: true,
		TestAppFactory: func(testing.TB) *tests.TestApp {
			return app
		},
	}

	scenario.Test(t)
}
