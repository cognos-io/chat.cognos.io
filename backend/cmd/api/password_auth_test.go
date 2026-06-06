package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestPasswordAuthWorks(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:   "password auth works for users",
		Method: http.MethodPost,
		URL:    "/api/collections/users/auth-with-password",
		Body: strings.NewReader(`{
			"identity": "test1@example.com",
			"password": "password"
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"token":"`,
			`"email":"test1@example.com"`,
		},
		TestAppFactory: setupTestApp,
	}

	scenario.Test(t)
}
