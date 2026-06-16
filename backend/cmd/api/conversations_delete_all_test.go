package main

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestConversationsDeleteAllRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "bulk delete conversations requires record auth",
		Method:          http.MethodDelete,
		URL:             "/api/v1/conversations",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

func TestConversationsDeleteAllDeletesOnlyOwnConversations(t *testing.T) {
	t.Parallel()

	mine1 := "delallmine00001"
	mine2 := "delallmine00002"
	theirs := "delalltheirs001"

	scenario := tests.ApiScenario{
		Name:           "delete all chats clears the caller's conversations and leaves others",
		Method:         http.MethodDelete,
		URL:            "/api/v1/conversations",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"deleted":2`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, mine1, "test1@example.com")
			seedOwnedConversation(t, app, mine2, "test1@example.com")
			seedOwnedConversation(t, app, theirs, "test2@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			for _, id := range []string{mine1, mine2} {
				if _, err := app.FindRecordById("conversations", id); err == nil {
					t.Fatalf("conversation %q still exists after delete-all", id)
				}
			}
			// The other user's conversation must be untouched.
			if _, err := app.FindRecordById("conversations", theirs); err != nil {
				t.Fatalf("other user's conversation %q was deleted: %v", theirs, err)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationsDeleteAllWithNoConversations(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "delete all chats with an empty list is a no-op",
		Method:          http.MethodDelete,
		URL:             "/api/v1/conversations",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"deleted":0`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}
