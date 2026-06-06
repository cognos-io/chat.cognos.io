package main

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

func TestUserEmailChangeIsRejected(t *testing.T) {
	t.Parallel()

	const userID = "uvi8zmr78j9y5hz"

	scenario := tests.ApiScenario{
		Name:   "user email change is rejected",
		Method: http.MethodPatch,
		URL:    fmt.Sprintf("/api/collections/users/records/%s", userID),
		Body: strings.NewReader(`{
			"email": "attacker@example.com"
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"email changes are not allowed"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}
