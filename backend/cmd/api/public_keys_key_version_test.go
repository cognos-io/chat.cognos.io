package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestConversationPublicKeysKeyVersionFieldExists(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	collection, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) error = %v", err)
	}

	if collection.Fields.GetByName("key_version") == nil {
		t.Fatalf("conversation_public_keys is missing the key_version field")
	}
}

func TestConversationPublicKeyGetIncludesKeyVersion(t *testing.T) {
	t.Parallel()

	const conversationID = "convpubkv000001"
	const publicKeyID = "convpubkey00010"

	scenario := tests.ApiScenario{
		Name:           "get conversation public key includes key_version",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/public-key",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"key_version":1`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedConversationPublicKeyWithID(t, app, publicKeyID, conversationID)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestConversationPublicKeyCreateStampsConversationKeyVersion(t *testing.T) {
	t.Parallel()

	const conversationID = "convpubkv000002"

	scenario := tests.ApiScenario{
		Name:   "create conversation public key uses conversation key_version",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/public-key",
		Body: strings.NewReader(`{
			"public_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			"public_key_signature": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"key_version":3`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			// Simulate two prior rotations so the new public key has to
			// stamp version 3 — proves the handler reads the generation
			// from the conversation row, not a hard-coded constant.
			if _, err := app.DB().
				NewQuery("UPDATE conversations SET key_version = 3 WHERE id = {:id}").
				Bind(dbx.Params{"id": conversationID}).
				Execute(); err != nil {
				t.Fatalf("UPDATE conversations error = %v", err)
			}
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, err := app.FindRecordsByFilter(
				"conversation_public_keys",
				"conversation = {:c}",
				"",
				10,
				0,
				dbx.Params{"c": conversationID},
			)
			if err != nil || len(records) != 1 {
				t.Fatalf("FindRecordsByFilter(public_keys) err=%v len=%d", err, len(records))
			}
			if got := records[0].GetInt("key_version"); got != 3 {
				t.Fatalf("public_keys.key_version = %d, want 3", got)
			}
		},
	}

	scenario.Test(t)
}
