package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestPasswordAuthIsDisabled(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:   "password auth disabled for users",
		Method: http.MethodPost,
		URL:    "/api/collections/users/auth-with-password",
		Body: strings.NewReader(`{
			"identity": "test1@example.com",
			"password": "password"
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`password authentication`,
		},
		TestAppFactory: setupTestApp,
	}

	scenario.Test(t)
}
