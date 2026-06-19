package main

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestUserEmailChangeRequestIsRejected(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:   "user email change request is rejected",
		Method: http.MethodPost,
		URL:    "/api/collections/users/request-email-change",
		Body: strings.NewReader(`{
			"newEmail": "attacker@example.com"
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Email changes are unavailable until account key re-auth is implemented."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestUserEmailChangeConfirmIsRejected(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users) error = %v", err)
	}

	token, err := record.NewEmailChangeToken("attacker@example.com")
	if err != nil {
		t.Fatalf("NewEmailChangeToken() error = %v", err)
	}

	scenario := tests.ApiScenario{
		Name:   "user email change confirm is rejected",
		Method: http.MethodPost,
		URL:    "/api/collections/users/confirm-email-change",
		Body: strings.NewReader(fmt.Sprintf(`{
			"token": %q,
			"password": "password-1234"
		}`, token)),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Email changes are unavailable until account key re-auth is implemented."`,
		},
		DisableTestAppCleanup: true,
		TestAppFactory: func(testing.TB) *tests.TestApp {
			return app
		},
	}

	scenario.Test(t)
}
