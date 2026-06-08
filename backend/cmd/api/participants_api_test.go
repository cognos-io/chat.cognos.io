package main

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestParticipantsListRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "participants route requires record auth",
		Method:          http.MethodGet,
		URL:             "/api/v1/conversations/anyconvid000001/participants",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

func TestParticipantsListReturnsActiveMembers(t *testing.T) {
	t.Parallel()

	const conversationID = "convparts000010"

	scenario := tests.ApiScenario{
		Name:           "list participants returns active members",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/participants",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"role":"Admin"`,
			`"role":"Editor"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			guest, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail = %v", err)
			}
			seedParticipant(t, app, conversationID, guest.Id, "Editor")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestParticipantsListRejectsNonParticipant(t *testing.T) {
	t.Parallel()

	const conversationID = "convparts000011"

	scenario := tests.ApiScenario{
		Name:           "list participants 404s for non-participants",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/participants",
		ExpectedStatus: http.StatusNotFound,
		ExpectedContent: []string{
			`"message":"Conversation not found."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestParticipantsListExcludesRevokedRows(t *testing.T) {
	t.Parallel()

	const conversationID = "convparts000012"

	scenario := tests.ApiScenario{
		Name:           "list participants excludes revoked rows",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/participants",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"role":"Admin"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			guest, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail = %v", err)
			}
			seedParticipant(t, app, conversationID, guest.Id, "Editor")
			// Soft-revoke the guest. The list endpoint must drop them but
			// keep the creator visible — the audit row stays in the DB.
			revokeParticipant(t, app, conversationID, guest.Id)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(body) = %v", err)
			}
			text := string(body)
			if !strings.Contains(text, `"role":"Admin"`) {
				t.Fatalf("response missing Admin participant: %s", text)
			}
			if strings.Contains(text, `"role":"Editor"`) {
				t.Fatalf("response includes revoked Editor row: %s", text)
			}
		},
	}

	scenario.Test(t)
}
