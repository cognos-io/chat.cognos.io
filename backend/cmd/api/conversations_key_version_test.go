package main

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestConversationsKeyVersionFieldExists(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	collection, err := app.FindCollectionByNameOrId("conversations")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversations) error = %v", err)
	}

	field := collection.Fields.GetByName("key_version")
	if field == nil {
		t.Fatalf("conversations is missing the key_version field")
	}
}

func TestConversationCreateAssignsKeyVersionOne(t *testing.T) {
	t.Parallel()

	encodedData := base64.StdEncoding.EncodeToString([]byte(`{"title":"With Key Version"}`))

	scenario := tests.ApiScenario{
		Name:   "create conversation responds with key_version 1",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations",
		Body: strings.NewReader(`{
			"data":"` + encodedData + `",
			"expiry_duration":""
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"key_version":1`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, err := app.FindRecordsByFilter(
				"conversations",
				"data={:data}",
				"",
				1,
				0,
				dbx.Params{"data": encodedData},
			)
			if err != nil || len(records) != 1 {
				t.Fatalf("FindRecordsByFilter(conversations) err=%v len=%d", err, len(records))
			}
			if got := records[0].GetInt("key_version"); got != 1 {
				t.Fatalf("conversations.key_version = %d, want 1", got)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationListIncludesKeyVersionForLegacyRows(t *testing.T) {
	t.Parallel()

	// Pin the contract that conversations created before the field
	// existed (or otherwise persisted without an explicit key_version)
	// still surface as `"key_version":1` to the client. The handler
	// upgrades any zero/NULL value to 1 so the client never sees a
	// missing/invalid generation.
	conversationID := "convlegacyk0001"

	scenario := tests.ApiScenario{
		Name:           "list conversations exposes key_version with legacy default",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + conversationID + `"`,
			`"key_version":1`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			clearKeyVersion(t, app, conversationID)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

// clearKeyVersion forces the key_version back to 0 via direct SQL so we can
// rehearse the "legacy row" path without committing the migration backfill's
// idempotency promise to memory across tests. PocketBase's number field
// keeps the column NOT NULL DEFAULT 0, so 0 is the closest reachable stand-in
// for a pre-migration row.
func clearKeyVersion(t testing.TB, app *tests.TestApp, conversationID string) {
	t.Helper()

	if _, err := app.DB().
		NewQuery("UPDATE conversations SET key_version = 0 WHERE id = {:id}").
		Bind(dbx.Params{"id": conversationID}).
		Execute(); err != nil {
		t.Fatalf("UPDATE conversations error = %v", err)
	}
}
