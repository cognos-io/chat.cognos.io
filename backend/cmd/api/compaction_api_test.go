package main

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// Cross-user denial coverage for the compaction surface (docs/api-permissions.md):
// every compaction route authorises against the owning conversation via
// conversationAccessibleByID, so a non-participant must get a neutral 404 —
// never a peek at another user's (encrypted) summaries, and never a write.

func seedCompactionRecord(t testing.TB, app *tests.TestApp, compactionID, conversationID string) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("conversation_compactions")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_compactions) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Id = compactionID
	record.Set("conversation", conversationID)
	record.Set("data", base64.StdEncoding.EncodeToString([]byte("opaque-ciphertext")))
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(conversation_compactions %q) error = %v", compactionID, err)
	}
}

func TestCompactionRoutesRejectNonParticipants(t *testing.T) {
	t.Parallel()

	const (
		conversationID = "convcompact0001"
		compactionID   = "compactrec00001"
	)

	manualBody := `{"data":"` + base64.StdEncoding.EncodeToString([]byte("sneaky")) + `"}`

	scenarios := []struct {
		name           string
		method         string
		url            string
		body           string
		expectedStatus int
	}{
		{
			name:           "non-participant cannot create a compaction",
			method:         http.MethodPost,
			url:            "/api/v1/conversations/" + conversationID + "/compactions",
			body:           `{"model_id":"llama-3-3-infomaniak","anchor_message_id":"x","messages":[{"role":"user","content":"hi"}]}`,
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "non-participant cannot list compactions",
			method:         http.MethodGet,
			url:            "/api/v1/conversations/" + conversationID + "/compactions",
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "non-participant cannot create manual memory",
			method:         http.MethodPost,
			url:            "/api/v1/conversations/" + conversationID + "/compactions/manual",
			body:           manualBody,
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "non-participant cannot update a compaction",
			method:         http.MethodPatch,
			url:            "/api/v1/conversation-compactions/" + compactionID,
			body:           manualBody,
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "non-participant cannot delete a compaction",
			method:         http.MethodDelete,
			url:            "/api/v1/conversation-compactions/" + compactionID,
			expectedStatus: http.StatusNotFound,
		},
	}

	for _, sc := range scenarios {
		sc := sc
		var body *strings.Reader
		if sc.body != "" {
			body = strings.NewReader(sc.body)
		} else {
			body = strings.NewReader("")
		}

		scenario := tests.ApiScenario{
			Name:            sc.name,
			Method:          sc.method,
			URL:             sc.url,
			Body:            body,
			ExpectedStatus:  sc.expectedStatus,
			ExpectedContent: []string{`"status":404`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				// test1 owns the conversation and its compaction; test2 probes.
				seedConversationRecord(t, app, conversationID)
				seedCompactionRecord(t, app, compactionID, conversationID)
				withRecordAuth("users", "test2@example.com")(t, app, e)
			},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				// The compaction record survives untouched — a cross-user
				// PATCH/DELETE must not write.
				record, err := app.FindRecordById("conversation_compactions", compactionID)
				if err != nil {
					t.Fatalf("compaction record missing after cross-user probe: %v", err)
				}
				if got := record.GetString("data"); got != base64.StdEncoding.EncodeToString([]byte("opaque-ciphertext")) {
					t.Fatal("compaction ciphertext was modified by a cross-user probe")
				}
				// No new compactions were created for the conversation.
				records, err := app.FindRecordsByFilter(
					"conversation_compactions", "conversation = {:c}", "", 0, 0,
					map[string]any{"c": conversationID},
				)
				if err != nil {
					t.Fatalf("FindRecordsByFilter(conversation_compactions) error = %v", err)
				}
				if len(records) != 1 {
					t.Fatalf("conversation has %d compactions after cross-user probe, want 1", len(records))
				}
			},
		}
		scenario.Test(t)
	}
}

// A participant can list; the seeded owner sees their own records. Sunny-path
// counterpart pinning that the 404s above come from authorisation, not from a
// broken route.
func TestCompactionListReturnsOwnRecordsToParticipant(t *testing.T) {
	t.Parallel()

	const (
		conversationID = "convcompact0002"
		compactionID   = "compactrec00002"
	)

	scenario := tests.ApiScenario{
		Name:           "participant lists their conversation's compactions",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/compactions",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + compactionID + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedConversationRecord(t, app, conversationID)
			seedCompactionRecord(t, app, compactionID, conversationID)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	scenario.Test(t)
}
