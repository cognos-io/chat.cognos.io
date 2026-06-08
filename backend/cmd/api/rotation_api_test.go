package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestConversationKeyRotateBumpsVersionAndPersistsNewKeys(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00001"

	scenario := tests.ApiScenario{
		Name:   "rotate bumps key_version and installs new public + secret keys",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"public_key_signature": "SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS=",
			"wrapped_secret_keys": [
				{"user_id":"uvi8zmr78j9y5hz","secret_key":"NEW-FOR-T1============================="},
				{"user_id":"xq9ndvc2kbrvrng","secret_key":"NEW-FOR-T2============================="}
			]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"conversation_id":"` + conversationID + `"`,
			`"key_version":2`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedParticipant(t, app, conversationID, "xq9ndvc2kbrvrng", "Editor")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			// Conversation row bumped.
			conv, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			if got := conv.GetInt("key_version"); got != 2 {
				t.Fatalf("conversations.key_version = %d, want 2", got)
			}

			// New public key row landed at the new generation.
			publicKeys, err := app.FindRecordsByFilter(
				"conversation_public_keys",
				"conversation = {:c} && key_version = {:v}",
				"",
				10,
				0,
				dbx.Params{"c": conversationID, "v": 2},
			)
			if err != nil || len(publicKeys) != 1 {
				t.Fatalf("expected 1 public_keys row at v2, got len=%d err=%v", len(publicKeys), err)
			}
			if got := publicKeys[0].GetString("public_key"); got != "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=" {
				t.Fatalf("new public_key not persisted, got %q", got)
			}

			// New secret_keys rows for both participants, at v2.
			for _, expected := range []struct{ user, key string }{
				{"uvi8zmr78j9y5hz", "NEW-FOR-T1============================="},
				{"xq9ndvc2kbrvrng", "NEW-FOR-T2============================="},
			} {
				row, err := app.FindFirstRecordByFilter(
					"conversation_secret_keys",
					"conversation = {:c} && user = {:u} && key_version = {:v}",
					dbx.Params{"c": conversationID, "u": expected.user, "v": 2},
				)
				if err != nil || row == nil {
					t.Fatalf("missing v2 secret_keys for %s: err=%v rec=%v", expected.user, err, row)
				}
				if got := row.GetString("secret_key"); got != expected.key {
					t.Fatalf("secret_keys[%s] = %q, want %q", expected.user, got, expected.key)
				}
			}
		},
	}

	scenario.Test(t)
}

func TestConversationKeyRotateRejectsNonAdmin(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00002"

	scenario := tests.ApiScenario{
		Name:   "Editor cannot rotate the conversation key",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"uvi8zmr78j9y5hz","secret_key":"x"},
				{"user_id":"xq9ndvc2kbrvrng","secret_key":"y"}
			]
		}`),
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`"message":"Only conversation admins can rotate the key."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			editor, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail = %v", err)
			}
			seedParticipant(t, app, conversationID, editor.Id, "Editor")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			conv, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			if got := conv.GetInt("key_version"); got != 1 {
				t.Fatalf("conversations.key_version = %d, want 1 (rotation must not have happened)", got)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationKeyRotateRequiresFullParticipantCoverage(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00003"

	// Two active participants but only one wrapped_secret_keys entry —
	// the rotation must refuse so a participant is never locked out of
	// the next generation.
	scenario := tests.ApiScenario{
		Name:   "rotate rejects payload missing an active participant",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"uvi8zmr78j9y5hz","secret_key":"x"}
			]
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Wrapped_secret_keys must cover every active participant."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedParticipant(t, app, conversationID, "xq9ndvc2kbrvrng", "Editor")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			conv, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			if got := conv.GetInt("key_version"); got != 1 {
				t.Fatalf("conversations.key_version = %d, want 1 (rotation must not have happened)", got)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationKeyRotateRejectsNonParticipantEntry(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00004"

	scenario := tests.ApiScenario{
		Name:   "rotate rejects wrapped key targeting a non-participant",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"uvi8zmr78j9y5hz","secret_key":"x"},
				{"user_id":"j8prcx3dum2l3kc","secret_key":"y"}
			]
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Wrapped_secret_keys entry targets a non-participant."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestConversationKeyRotateLayersNewPublicKeyOnTopOfV1(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00006"

	// Reproduce the production layout: a pre-existing v1 public_key row.
	// Before the (conversation, key_version) unique index landed, the
	// (conversation) unique index would have made the rotation handler's
	// v2 insert fail, taking the whole transaction with it. Pin that the
	// rotation now succeeds and the read-side filter picks the new row.
	rotateScenario := tests.ApiScenario{
		Name:   "rotate works when a v1 public_key row already exists",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"uvi8zmr78j9y5hz","secret_key":"WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW="}
			]
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"key_version":2`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedConversationPublicKeyWithID(t, app, "convpubrotv1001", conversationID)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, err := app.FindRecordsByFilter(
				"conversation_public_keys",
				"conversation = {:c}",
				"key_version",
				10,
				0,
				dbx.Params{"c": conversationID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(public_keys) err=%v", err)
			}
			if len(records) != 2 {
				t.Fatalf("expected 2 public_keys rows (v1 audit + v2 active), got %d", len(records))
			}
			versions := []int{records[0].GetInt("key_version"), records[1].GetInt("key_version")}
			if versions[0] != 1 || versions[1] != 2 {
				t.Fatalf("public_keys key_versions = %v, want [1 2]", versions)
			}
		},
	}
	rotateScenario.Test(t)
}

func TestConversationKeyRotateInvalidatesPreviousSecretKey(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00005"

	// Sanity check the read-side rotation contract: rotate the key, then
	// hit GET /secret-key — the response must carry the NEW wrapped key
	// (the v1 row stays in the DB as audit data but is no longer
	// reachable through the API per the current-version read filter).
	rotateScenario := tests.ApiScenario{
		Name:   "rotate then GET secret-key returns the new wrapped value",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"uvi8zmr78j9y5hz","secret_key":"VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV="}
			]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{`"key_version":2`},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedConversationSecretKey(t, app, conversationID, "uvi8zmr78j9y5hz")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			// Two secret_keys rows exist (v1 audit + v2 active). The
			// current-version read filter must surface v2 only.
			rows, err := app.FindRecordsByFilter(
				"conversation_secret_keys",
				"conversation = {:c} && user = {:u}",
				"key_version",
				10,
				0,
				dbx.Params{"c": conversationID, "u": "uvi8zmr78j9y5hz"},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter err=%v", err)
			}
			if len(rows) != 2 {
				t.Fatalf("expected 2 secret_keys rows (v1 audit + v2 active), got %d", len(rows))
			}
		},
	}
	rotateScenario.Test(t)
}
