package main

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestLogoutRotatesTokenKey(t *testing.T) {
	t.Parallel()

	originalTokenKey := ""

	scenario := tests.ApiScenario{
		Name:           "logout rotates token key",
		Method:         http.MethodPost,
		URL:            "/v1/auth/logout",
		ExpectedStatus: http.StatusNoContent,
		ExpectedEvents: map[string]int{},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatal(err)
			}
			originalTokenKey = record.TokenKey()
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatal(err)
			}

			if record.TokenKey() == originalTokenKey {
				t.Fatal("TokenKey() did not rotate on logout")
			}
		},
	}

	scenario.Test(t)
}
