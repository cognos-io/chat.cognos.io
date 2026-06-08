package main

import (
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestConversationsRequireAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "conversations route requires record auth",
		Method:          http.MethodGet,
		URL:             "/api/v1/conversations",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

func TestConversationCreate(t *testing.T) {
	t.Parallel()

	encodedData := base64.StdEncoding.EncodeToString([]byte(`{"title":"New Conversation"}`))

	scenario := tests.ApiScenario{
		Name:   "create conversation",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations",
		Body: strings.NewReader(`{
			"data":"` + encodedData + `",
			"expiry_duration":"24h"
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"data":"` + encodedData + `"`,
			`"expiry_duration":"24h"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, err := app.FindRecordsByFilter(
				"conversations",
				"data={:data}",
				"",
				10,
				0,
				dbx.Params{"data": encodedData},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(conversations) error = %v", err)
			}
			if len(records) != 1 {
				t.Fatalf("FindRecordsByFilter(conversations) len = %d, want %d", len(records), 1)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationListOnlyReturnsOwnedConversations(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "list conversations only returns owned conversations",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"ownedconv000001"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, "ownedconv000001", "test1@example.com")
			seedOwnedConversation(t, app, "ownedconv000002", "test2@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			bodyBytes, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(response.Body) error = %v", err)
			}
			body := string(bodyBytes)
			if strings.Contains(body, `"id":"ownedconv000002"`) {
				t.Fatalf("response body contains other user's conversation: %s", body)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationUpdate(t *testing.T) {
	t.Parallel()

	conversationID := "ownedconv000003"
	updatedData := base64.StdEncoding.EncodeToString([]byte(`{"title":"Updated Conversation"}`))

	scenario := tests.ApiScenario{
		Name:   "update conversation",
		Method: http.MethodPatch,
		URL:    "/api/v1/conversations/" + conversationID,
		Body: strings.NewReader(`{
			"data":"` + updatedData + `",
			"expiry_duration":"168h"
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + conversationID + `"`,
			`"data":"` + updatedData + `"`,
			`"expiry_duration":"168h"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestConversationDelete(t *testing.T) {
	t.Parallel()

	conversationID := "ownedconv000004"

	scenario := tests.ApiScenario{
		Name:           "delete conversation",
		Method:         http.MethodDelete,
		URL:            "/api/v1/conversations/" + conversationID,
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			_, err := app.FindRecordById("conversations", conversationID)
			if err == nil {
				t.Fatalf("FindRecordById(conversations, %q) error = nil, want non-nil after delete", conversationID)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationDeleteOtherUserReturnsNotFound(t *testing.T) {
	t.Parallel()

	conversationID := "ownedconv000005"

	scenario := tests.ApiScenario{
		Name:            "delete other user conversation returns not found",
		Method:          http.MethodDelete,
		URL:             "/api/v1/conversations/" + conversationID,
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

func TestConversationMessagesAndMutations(t *testing.T) {
	t.Parallel()

	conversationID := "convmsgs0000001"
	messageID := "msgowner0000001"

	listScenario := tests.ApiScenario{
		Name:           "list messages",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/messages?page=1&page_size=100",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + messageID + `"`,
			`"totalItems":1`,
			`"totalPages":1`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedMessage(t, app, messageID, conversationID, true)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	listScenario.Test(t)

	clearExpiryScenario := tests.ApiScenario{
		Name:           "clear message expiry",
		Method:         http.MethodPatch,
		URL:            "/api/v1/messages/" + messageID,
		Body:           strings.NewReader(`{"clear_expires":true}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + messageID + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedMessage(t, app, messageID, conversationID, true)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			record, err := app.FindRecordById("messages", messageID)
			if err != nil {
				t.Fatalf("FindRecordById(messages, %q) error = %v", messageID, err)
			}
			if got := record.GetString("expires"); got != "" {
				t.Fatalf("messages[%q].expires = %q, want empty", messageID, got)
			}
		},
	}
	clearExpiryScenario.Test(t)

	deleteScenario := tests.ApiScenario{
		Name:           "delete message",
		Method:         http.MethodDelete,
		URL:            "/api/v1/messages/" + messageID,
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedMessage(t, app, messageID, conversationID, false)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			_, err := app.FindRecordById("messages", messageID)
			if err == nil {
				t.Fatalf("FindRecordById(messages, %q) error = nil, want non-nil after delete", messageID)
			}
		},
	}
	deleteScenario.Test(t)
}

func TestMessageDeleteOtherUserReturnsNotFound(t *testing.T) {
	t.Parallel()

	conversationID := "convmsgs0000002"
	messageID := "msgowner0000002"

	scenario := tests.ApiScenario{
		Name:            "delete other user message returns not found",
		Method:          http.MethodDelete,
		URL:             "/api/v1/messages/" + messageID,
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Message not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedMessage(t, app, messageID, conversationID, false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestConversationListReturnsConversationsForNonCreatorParticipant(t *testing.T) {
	t.Parallel()

	conversationID := "convshared00001"

	scenario := tests.ApiScenario{
		Name:           "non-creator participant sees shared conversation in list",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + conversationID + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			// test1 owns the conversation; test2 is added as an Editor
			// participant. The list endpoint must return the conversation to
			// test2 — that's the whole point of moving access off the
			// "creator only" check.
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			guest, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(test2) = %v", err)
			}
			seedParticipant(t, app, conversationID, guest.Id, "Editor")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestConversationMessagesAccessibleToNonCreatorParticipant(t *testing.T) {
	t.Parallel()

	conversationID := "convshared00002"
	messageID := "msgshared000001"

	scenario := tests.ApiScenario{
		Name:           "non-creator participant can list messages",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/messages",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + messageID + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedMessage(t, app, messageID, conversationID, false)
			guest, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(test2) = %v", err)
			}
			seedParticipant(t, app, conversationID, guest.Id, "Viewer")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestConversationCreateRegistersCreatorParticipant(t *testing.T) {
	t.Parallel()

	encodedData := base64.StdEncoding.EncodeToString([]byte(`{"title":"With Participant"}`))

	scenario := tests.ApiScenario{
		Name:   "creating a conversation seeds an Admin participant for the creator",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations",
		Body: strings.NewReader(`{
			"data":"` + encodedData + `",
			"expiry_duration":""
		}`),
		ExpectedStatus:  http.StatusCreated,
		ExpectedContent: []string{`"data":"` + encodedData + `"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			conversations, err := app.FindRecordsByFilter(
				"conversations",
				"data={:data}",
				"",
				1,
				0,
				dbx.Params{"data": encodedData},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(conversations) error = %v", err)
			}
			if len(conversations) != 1 {
				t.Fatalf("FindRecordsByFilter(conversations) len = %d, want 1", len(conversations))
			}
			conv := conversations[0]

			user, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail = %v", err)
			}

			participant, err := app.FindFirstRecordByFilter(
				"participants",
				"conversation = {:c} && user = {:u}",
				dbx.Params{"c": conv.Id, "u": user.Id},
			)
			if err != nil || participant == nil {
				t.Fatalf("creator participant not seeded: err=%v record=%v", err, participant)
			}
			if got := participant.GetString("role"); got != "Admin" {
				t.Fatalf("creator role = %q, want %q", got, "Admin")
			}
		},
	}

	scenario.Test(t)
}

func TestListMessagesUsesConversationOwnership(t *testing.T) {
	t.Parallel()

	conversationID := "convmsgs0000003"
	messageID := "msgowner0000003"

	scenario := tests.ApiScenario{
		Name:            "list other user conversation messages returns not found",
		Method:          http.MethodGet,
		URL:             "/api/v1/conversations/" + conversationID + "/messages",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Conversation not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedMessage(t, app, messageID, conversationID, false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func seedOwnedConversation(t testing.TB, app *tests.TestApp, conversationID string, ownerEmail string) {
	t.Helper()

	userRecord, err := app.FindAuthRecordByEmail("users", ownerEmail)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", ownerEmail, err)
	}

	collection, err := app.FindCollectionByNameOrId("conversations")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversations) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Id = conversationID
	record.Set("creator", userRecord.Id)
	record.Set("data", base64.StdEncoding.EncodeToString([]byte(`{"title":"Seeded"}`)))
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(conversationRecord) error = %v", err)
	}

	// Mirror what ConversationsCreate now does in production: every owned
	// conversation must have an Admin participant row, otherwise the
	// participant-based access check in ownedConversationRecord will treat
	// the creator as a non-participant and return 404.
	seedParticipant(t, app, conversationID, userRecord.Id, "Admin")
}

func seedParticipant(t testing.TB, app *tests.TestApp, conversationID, userID, role string) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("participants")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(participants) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Set("conversation", conversationID)
	record.Set("user", userID)
	record.Set("role", role)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(participantRecord) error = %v", err)
	}
}

func seedMessage(t testing.TB, app *tests.TestApp, messageID, conversationID string, withExpiry bool) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("messages")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(messages) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Id = messageID
	record.Set("conversation", conversationID)
	record.Set("data", base64.StdEncoding.EncodeToString([]byte(`ciphertext`)))
	if withExpiry {
		record.Set("expires", "2026-06-07 00:00:00.000Z")
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(messageRecord) error = %v", err)
	}
}
