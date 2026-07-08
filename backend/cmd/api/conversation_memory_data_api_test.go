package main

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// The per-chat memory switch flips a flag INSIDE the client-encrypted data, so
// the wire payload is just the re-encrypted blob. The server stores it verbatim.
var memoryDataBlob = base64.StdEncoding.EncodeToString(
	[]byte(`{"title":"Seeded","memoryDisabled":true}`),
)

func TestConversationMemoryDataUpdate(t *testing.T) {
	t.Parallel()

	conversationID := "convmemdata0001"

	scenario := tests.ApiScenario{
		Name:            "persist re-encrypted conversation data for the memory switch",
		Method:          http.MethodPatch,
		URL:             "/api/v1/conversations/" + conversationID + "/memory",
		Body:            strings.NewReader(`{"data":"` + memoryDataBlob + `"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"id":"` + conversationID + `"`, `"data":"` + memoryDataBlob + `"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			record, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations, %q) error = %v", conversationID, err)
			}
			if got := record.GetString("data"); got != memoryDataBlob {
				t.Fatalf("data = %q, want the re-encrypted blob", got)
			}
		},
	}

	scenario.Test(t)
}

// Toggling the memory flag must not reset last_activity_at — otherwise it would
// reorder the sidebar and postpone the auto-delete clock.
func TestConversationMemoryDataUpdateDoesNotBumpLastActivity(t *testing.T) {
	t.Parallel()

	conversationID := "convmemdata0002"
	const seededActivity = "2026-01-01 00:00:00.000Z"

	scenario := tests.ApiScenario{
		Name:            "memory data update keeps last_activity_at",
		Method:          http.MethodPatch,
		URL:             "/api/v1/conversations/" + conversationID + "/memory",
		Body:            strings.NewReader(`{"data":"` + memoryDataBlob + `"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"id":"` + conversationID + `"`},
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

func TestConversationMemoryDataUpdateOtherUserReturnsNotFound(t *testing.T) {
	t.Parallel()

	conversationID := "convmemdata0003"

	scenario := tests.ApiScenario{
		Name:            "update memory data on other user conversation returns not found",
		Method:          http.MethodPatch,
		URL:             "/api/v1/conversations/" + conversationID + "/memory",
		Body:            strings.NewReader(`{"data":"` + memoryDataBlob + `"}`),
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

func TestConversationMemoryDataUpdateRejectsEmpty(t *testing.T) {
	t.Parallel()

	conversationID := "convmemdata0004"

	scenario := tests.ApiScenario{
		Name:            "reject empty conversation data",
		Method:          http.MethodPatch,
		URL:             "/api/v1/conversations/" + conversationID + "/memory",
		Body:            strings.NewReader(`{"data":""}`),
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
