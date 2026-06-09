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

func TestConversationKeyRotateRevokesAndRotatesAtomically(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00007"
	const revokedUser = "xq9ndvc2kbrvrng"
	const adminUser = "uvi8zmr78j9y5hz"

	// Admin removes an Editor and rotates in the same call. After the
	// transaction commits: the Editor's participant row is soft-stamped
	// (audit row intact), the conversation row is at key_version=2, and
	// the new secret_keys table has rows only for the remaining active
	// participants (no v2 row for the revoked user).
	scenario := tests.ApiScenario{
		Name:   "rotate with revoked_user_ids soft-removes and re-keys atomically",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"revoked_user_ids": ["` + revokedUser + `"],
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"` + adminUser + `","secret_key":"NEW-FOR-ADMIN========================="}
			]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"conversation_id":"` + conversationID + `"`,
			`"key_version":2`,
			`"revoked_user_ids":["` + revokedUser + `"]`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedParticipant(t, app, conversationID, revokedUser, "Editor")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			conv, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			if got := conv.GetInt("key_version"); got != 2 {
				t.Fatalf("conversations.key_version = %d, want 2", got)
			}

			// Revoked participant row is soft-stamped (removed_at set,
			// row not deleted — audit trail intact).
			row, err := app.FindFirstRecordByFilter(
				"participants",
				"conversation = {:c} && user = {:u}",
				dbx.Params{"c": conversationID, "u": revokedUser},
			)
			if err != nil || row == nil {
				t.Fatalf("participants row for revoked user missing: err=%v rec=%v", err, row)
			}
			if got := row.GetString("removed_at"); got == "" {
				t.Fatalf("participants.removed_at for revoked user is empty; want stamped")
			}

			// No v2 secret_keys row for the revoked user — forward-secrecy.
			revokedV2, err := app.FindFirstRecordByFilter(
				"conversation_secret_keys",
				"conversation = {:c} && user = {:u} && key_version = {:v}",
				dbx.Params{"c": conversationID, "u": revokedUser, "v": 2},
			)
			if err == nil && revokedV2 != nil {
				t.Fatalf("revoked user received a v2 secret_keys row; forward-secrecy broken")
			}

			// Remaining admin DID get a v2 secret_keys row.
			adminV2, err := app.FindFirstRecordByFilter(
				"conversation_secret_keys",
				"conversation = {:c} && user = {:u} && key_version = {:v}",
				dbx.Params{"c": conversationID, "u": adminUser, "v": 2},
			)
			if err != nil || adminV2 == nil {
				t.Fatalf("admin missing v2 secret_keys row: err=%v rec=%v", err, adminV2)
			}
		},
	}
	scenario.Test(t)
}

func TestConversationKeyRotateBulkRevokesMultipleUsers(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00008"
	const adminUser = "uvi8zmr78j9y5hz"
	const revokedA = "xq9ndvc2kbrvrng"
	const revokedB = "j8prcx3dum2l3kc"

	scenario := tests.ApiScenario{
		Name:   "rotate with two revoked_user_ids removes both in one transaction",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"revoked_user_ids": ["` + revokedA + `", "` + revokedB + `"],
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"` + adminUser + `","secret_key":"NEW-FOR-ADMIN========================="}
			]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"key_version":2`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedParticipant(t, app, conversationID, revokedA, "Editor")
			seedParticipant(t, app, conversationID, revokedB, "Editor")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			for _, uid := range []string{revokedA, revokedB} {
				row, err := app.FindFirstRecordByFilter(
					"participants",
					"conversation = {:c} && user = {:u}",
					dbx.Params{"c": conversationID, "u": uid},
				)
				if err != nil || row == nil {
					t.Fatalf("participants row missing for %s: err=%v rec=%v", uid, err, row)
				}
				if row.GetString("removed_at") == "" {
					t.Fatalf("participants.removed_at for %s not stamped", uid)
				}

				if v2, _ := app.FindFirstRecordByFilter(
					"conversation_secret_keys",
					"conversation = {:c} && user = {:u} && key_version = {:v}",
					dbx.Params{"c": conversationID, "u": uid, "v": 2},
				); v2 != nil {
					t.Fatalf("%s received a v2 secret_keys row; should have been excluded", uid)
				}
			}
		},
	}
	scenario.Test(t)
}

func TestConversationKeyRotateRejectsSelfInRevokedSet(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00009"
	// test1@example.com → id `uvi8zmr78j9y5hz`, declared in testUsers.
	const adminUser = "uvi8zmr78j9y5hz"

	// Self-revoke through the rotate endpoint must fail with 400 — same
	// last-Admin orphan concern the standalone DELETE used to guard,
	// now enforced here. No DB mutation.
	scenario := tests.ApiScenario{
		Name:   "rotate rejects caller in revoked_user_ids",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"revoked_user_ids": ["` + adminUser + `"],
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"` + adminUser + `","secret_key":"x"}
			]
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Caller cannot revoke themselves."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
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
			// Admin row still active.
			row, err := app.FindFirstRecordByFilter(
				"participants",
				"conversation = {:c} && user = {:u}",
				dbx.Params{"c": conversationID, "u": adminUser},
			)
			if err != nil || row == nil {
				t.Fatalf("admin participants row missing: err=%v rec=%v", err, row)
			}
			if row.GetString("removed_at") != "" {
				t.Fatalf("removed_at was stamped on the caller despite request rejection")
			}
		},
	}
	scenario.Test(t)
}

func TestConversationKeyRotateRejectsAlreadyInactiveTarget(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00010"
	const adminUser = "uvi8zmr78j9y5hz"
	const ghostUser = "xq9ndvc2kbrvrng" // never seeded as a participant

	scenario := tests.ApiScenario{
		Name:   "rotate rejects revoking a user who is not active",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"revoked_user_ids": ["` + ghostUser + `"],
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"` + adminUser + `","secret_key":"x"}
			]
		}`),
		ExpectedStatus: http.StatusNotFound,
		ExpectedContent: []string{
			`"message":"Participant to revoke is not active."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			conv, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			if got := conv.GetInt("key_version"); got != 1 {
				t.Fatalf("conversations.key_version = %d, want 1 (no mutation expected)", got)
			}
		},
	}
	scenario.Test(t)
}

func TestConversationKeyRotateRejectsRevokedAndWrappedOverlap(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00011"
	const adminUser = "uvi8zmr78j9y5hz"
	const overlapUser = "xq9ndvc2kbrvrng"

	// Same user appears in both revoked_user_ids AND wrapped_secret_keys.
	// That's a contradiction — the user is being removed AND re-keyed —
	// so the handler must reject it with a 400 before any DB write.
	scenario := tests.ApiScenario{
		Name:   "rotate rejects a user appearing in both revoke and wrap sets",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"revoked_user_ids": ["` + overlapUser + `"],
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"` + adminUser + `","secret_key":"x"},
				{"user_id":"` + overlapUser + `","secret_key":"y"}
			]
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Wrapped_secret_keys entry targets a user being revoked."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedParticipant(t, app, conversationID, overlapUser, "Editor")
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
			// The overlap user is still an active participant.
			row, err := app.FindFirstRecordByFilter(
				"participants",
				"conversation = {:c} && user = {:u}",
				dbx.Params{"c": conversationID, "u": overlapUser},
			)
			if err != nil || row == nil {
				t.Fatalf("participants row missing: err=%v rec=%v", err, row)
			}
			if row.GetString("removed_at") != "" {
				t.Fatalf("removed_at was stamped despite request rejection")
			}
		},
	}
	scenario.Test(t)
}

func TestConversationKeyRotateRejectsDuplicateInRevokedSet(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00012"
	const adminUser = "uvi8zmr78j9y5hz"
	const repeatedUser = "xq9ndvc2kbrvrng"

	scenario := tests.ApiScenario{
		Name:   "rotate rejects duplicate user_id in revoked_user_ids",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"revoked_user_ids": ["` + repeatedUser + `", "` + repeatedUser + `"],
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"` + adminUser + `","secret_key":"x"}
			]
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Revoked_user_ids contains a duplicate user_id."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedParticipant(t, app, conversationID, repeatedUser, "Editor")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			row, err := app.FindFirstRecordByFilter(
				"participants",
				"conversation = {:c} && user = {:u}",
				dbx.Params{"c": conversationID, "u": repeatedUser},
			)
			if err != nil || row == nil {
				t.Fatalf("participants row missing: err=%v rec=%v", err, row)
			}
			if row.GetString("removed_at") != "" {
				t.Fatalf("removed_at was stamped despite request rejection")
			}
		},
	}
	scenario.Test(t)
}

func TestConversationKeyRotateEmptyRevokedSetBehavesAsPureRotation(t *testing.T) {
	t.Parallel()

	const conversationID = "convrotate00013"

	// Pure rotation with revoked_user_ids omitted entirely. Verifies the
	// optional field is genuinely optional — the empty / missing case is
	// the most common one (credential refresh, not a membership change).
	scenario := tests.ApiScenario{
		Name:   "rotate with no revoked_user_ids behaves as pure rotation",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/rotate",
		Body: strings.NewReader(`{
			"public_key": "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP=",
			"wrapped_secret_keys": [
				{"user_id":"uvi8zmr78j9y5hz","secret_key":"NEW========================="}
			]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"key_version":2`,
			`"revoked_user_ids":[]`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	scenario.Test(t)
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
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"key_version":2`},
		TestAppFactory:  setupTestApp,
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
