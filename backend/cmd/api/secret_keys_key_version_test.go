package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestConversationSecretKeysKeyVersionFieldExists(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	collection, err := app.FindCollectionByNameOrId("conversation_secret_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_secret_keys) error = %v", err)
	}

	if collection.Fields.GetByName("key_version") == nil {
		t.Fatalf("conversation_secret_keys is missing the key_version field")
	}
}

func TestConversationSecretKeyGetIncludesKeyVersion(t *testing.T) {
	t.Parallel()

	const conversationID = "convseckv000001"

	scenario := tests.ApiScenario{
		Name:           "get conversation secret key includes key_version",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/secret-key",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"key_version":1`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedConversationSecretKey(t, app, conversationID, "uvi8zmr78j9y5hz")
			// Legacy seed leaves key_version at 0 — handler must surface 1
			// so clients always see a usable generation.
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestConversationSecretKeyCreateStampsConversationKeyVersion(t *testing.T) {
	t.Parallel()

	const conversationID = "convseckv000002"

	scenario := tests.ApiScenario{
		Name:   "create conversation secret key uses conversation key_version",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/secret-key",
		Body: strings.NewReader(`{
			"secret_key": "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD="
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"key_version":2`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			// Simulate a conversation that has already been rotated once so
			// the create handler must stamp the NEW wrapped key at version 2
			// instead of the default 1 — pinning that the stamp reads from
			// the conversation, not a constant.
			if _, err := app.DB().
				NewQuery("UPDATE conversations SET key_version = 2 WHERE id = {:id}").
				Bind(dbx.Params{"id": conversationID}).
				Execute(); err != nil {
				t.Fatalf("UPDATE conversations error = %v", err)
			}
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, err := app.FindRecordsByFilter(
				"conversation_secret_keys",
				"conversation = {:c}",
				"",
				10,
				0,
				dbx.Params{"c": conversationID},
			)
			if err != nil || len(records) != 1 {
				t.Fatalf("FindRecordsByFilter(secret_keys) err=%v len=%d", err, len(records))
			}
			if got := records[0].GetInt("key_version"); got != 2 {
				t.Fatalf("secret_keys.key_version = %d, want 2", got)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationSecretKeyGetIgnoresStaleVersions(t *testing.T) {
	t.Parallel()

	const conversationID = "convseckv000010"

	scenario := tests.ApiScenario{
		Name:           "get conversation secret key skips stale key_version rows",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/secret-key",
		ExpectedStatus: http.StatusNotFound,
		ExpectedContent: []string{
			`"message":"Conversation secret key not found."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			// Bump the conversation to generation 2; the seeded wrapped
			// key is still at version 1, so the read-side filter must
			// treat it as stale and return 404 instead of leaking the
			// pre-rotation wrapper.
			if _, err := app.DB().
				NewQuery("UPDATE conversations SET key_version = 2 WHERE id = {:id}").
				Bind(dbx.Params{"id": conversationID}).
				Execute(); err != nil {
				t.Fatalf("UPDATE conversations error = %v", err)
			}
			seedConversationSecretKey(t, app, conversationID, "uvi8zmr78j9y5hz")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestConversationSecretKeyCreateDefaultsToVersionOne(t *testing.T) {
	t.Parallel()

	const conversationID = "convseckv000003"

	scenario := tests.ApiScenario{
		Name:   "create conversation secret key defaults to key_version 1",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/secret-key",
		Body: strings.NewReader(`{
			"secret_key": "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE="
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"key_version":1`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}
