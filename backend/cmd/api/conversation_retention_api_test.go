package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestConversationRetentionUpdate(t *testing.T) {
	t.Parallel()

	conversationID := "convretain00001"

	scenario := tests.ApiScenario{
		Name:           "set per-conversation retention",
		Method:         http.MethodPatch,
		URL:            "/api/v1/conversations/" + conversationID + "/retention",
		Body:           strings.NewReader(`{"retention_days":7}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + conversationID + `"`,
			`"retention_days":7`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			record, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations, %q) error = %v", conversationID, err)
			}
			if got := record.GetInt("retention_days"); got != 7 {
				t.Fatalf("retention_days = %d, want 7", got)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationRetentionUpdateNeverSentinel(t *testing.T) {
	t.Parallel()

	conversationID := "convretain00002"

	scenario := tests.ApiScenario{
		Name:           "set per-conversation retention to never (-1)",
		Method:         http.MethodPatch,
		URL:            "/api/v1/conversations/" + conversationID + "/retention",
		Body:           strings.NewReader(`{"retention_days":-1}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"retention_days":-1`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

// Setting retention must not reset last_activity_at — otherwise configuring a
// window would postpone the very deletion it schedules.
func TestConversationRetentionUpdateDoesNotBumpLastActivity(t *testing.T) {
	t.Parallel()

	conversationID := "convretain00003"
	const seededActivity = "2026-01-01 00:00:00.000Z"

	scenario := tests.ApiScenario{
		Name:            "retention update keeps last_activity_at",
		Method:          http.MethodPatch,
		URL:             "/api/v1/conversations/" + conversationID + "/retention",
		Body:            strings.NewReader(`{"retention_days":30}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"retention_days":30`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			setConversationLastActivityAt(t, app, conversationID, seededActivity)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			record, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById error = %v", err)
			}
			if got := record.GetString("last_activity_at"); !strings.HasPrefix(got, "2026-01-01") {
				t.Fatalf("last_activity_at = %q, want it unchanged (2026-01-01…)", got)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationRetentionUpdateOtherUserReturnsNotFound(t *testing.T) {
	t.Parallel()

	conversationID := "convretain00004"

	scenario := tests.ApiScenario{
		Name:            "set retention on other user conversation returns not found",
		Method:          http.MethodPatch,
		URL:             "/api/v1/conversations/" + conversationID + "/retention",
		Body:            strings.NewReader(`{"retention_days":7}`),
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Conversation not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestConversationRetentionUpdateRejectsInvalid(t *testing.T) {
	t.Parallel()

	conversationID := "convretain00005"

	for _, tc := range []struct {
		name string
		body string
	}{
		{"missing field", `{}`},
		{"below never sentinel", `{"retention_days":-2}`},
		{"above max", `{"retention_days":9999}`},
	} {
		scenario := tests.ApiScenario{
			Name:            "reject invalid retention: " + tc.name,
			Method:          http.MethodPatch,
			URL:             "/api/v1/conversations/" + conversationID + "/retention",
			Body:            strings.NewReader(tc.body),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"status":400`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOwnedConversation(t, app, conversationID, "test1@example.com")
				withRecordAuth("users", "test1@example.com")(t, app, e)
			},
		}
		scenario.Test(t)
	}
}
