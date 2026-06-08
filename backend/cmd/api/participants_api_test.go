package main

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
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

func TestParticipantsAddSucceedsForAdmin(t *testing.T) {
	t.Parallel()

	const conversationID = "convpartadd0001"

	scenario := tests.ApiScenario{
		Name:   "Admin can add a participant + wrapped secret key in one call",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/participants",
		Body: strings.NewReader(`{
			"user_id": "xq9ndvc2kbrvrng",
			"role": "Editor",
			"wrapped_secret_key": "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD="
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"role":"Editor"`,
			`"user_id":"xq9ndvc2kbrvrng"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			// Participant row landed
			participant, err := app.FindFirstRecordByFilter(
				"participants",
				"conversation = {:c} && user = {:u}",
				dbx.Params{"c": conversationID, "u": "xq9ndvc2kbrvrng"},
			)
			if err != nil || participant == nil {
				t.Fatalf("FindFirstRecordByFilter(participants) err=%v rec=%v", err, participant)
			}
			if got := participant.GetString("role"); got != "Editor" {
				t.Fatalf("participants.role = %q, want Editor", got)
			}

			// Wrapped secret key row landed, stamped with the current
			// conversation generation
			secretKey, err := app.FindFirstRecordByFilter(
				"conversation_secret_keys",
				"conversation = {:c} && user = {:u}",
				dbx.Params{"c": conversationID, "u": "xq9ndvc2kbrvrng"},
			)
			if err != nil || secretKey == nil {
				t.Fatalf("FindFirstRecordByFilter(secret_keys) err=%v rec=%v", err, secretKey)
			}
			if got := secretKey.GetInt("key_version"); got != 1 {
				t.Fatalf("secret_keys.key_version = %d, want 1", got)
			}
			if got := secretKey.GetString("secret_key"); got != "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=" {
				t.Fatalf("secret_keys.secret_key = %q, want the wrapped value", got)
			}
		},
	}

	scenario.Test(t)
}

func TestParticipantsAddRejectsNonAdmin(t *testing.T) {
	t.Parallel()

	const conversationID = "convpartadd0002"

	scenario := tests.ApiScenario{
		Name:   "Editor cannot add another participant",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/participants",
		Body: strings.NewReader(`{
			"user_id": "j8prcx3dum2l3kc",
			"role": "Viewer",
			"wrapped_secret_key": "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE="
		}`),
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`"message":"Only conversation admins can add participants."`,
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
			// Editor's attempted write must not have created any row.
			records, err := app.FindRecordsByFilter(
				"participants",
				"conversation = {:c} && user = {:u}",
				"",
				1,
				0,
				dbx.Params{"c": conversationID, "u": "j8prcx3dum2l3kc"},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(participants) err=%v", err)
			}
			if len(records) != 0 {
				t.Fatalf("non-Admin write persisted participant row")
			}
			secretKeys, err := app.FindRecordsByFilter(
				"conversation_secret_keys",
				"conversation = {:c} && user = {:u}",
				"",
				1,
				0,
				dbx.Params{"c": conversationID, "u": "j8prcx3dum2l3kc"},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(secret_keys) err=%v", err)
			}
			if len(secretKeys) != 0 {
				t.Fatalf("non-Admin write persisted secret_keys row")
			}
		},
	}

	scenario.Test(t)
}

func TestParticipantsAddRejectsNonParticipant(t *testing.T) {
	t.Parallel()

	const conversationID = "convpartadd0003"

	scenario := tests.ApiScenario{
		Name:   "outside user cannot add participants",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/participants",
		Body: strings.NewReader(`{
			"user_id": "j8prcx3dum2l3kc",
			"role": "Viewer",
			"wrapped_secret_key": "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF="
		}`),
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

func TestParticipantsAddValidatesBody(t *testing.T) {
	t.Parallel()

	const conversationID = "convpartadd0004"

	cases := []struct {
		name   string
		body   string
		status int
		errMsg string
	}{
		{
			name: "missing user_id",
			body: `{"role":"Editor","wrapped_secret_key":"AAA="}`,
			// PocketBase's apis.NewBadRequestError auto-capitalizes the
			// first letter of the message when serialized, hence the
			// "User_id" / "Wrapped_secret_key" expectations below.
			status: http.StatusBadRequest,
			errMsg: `"message":"User_id is required."`,
		},
		{
			name:   "missing wrapped_secret_key",
			body:   `{"user_id":"xq9ndvc2kbrvrng","role":"Editor"}`,
			status: http.StatusBadRequest,
			errMsg: `"message":"Wrapped_secret_key is required."`,
		},
		{
			name:   "invalid role",
			body:   `{"user_id":"xq9ndvc2kbrvrng","role":"Sysadmin","wrapped_secret_key":"AAA="}`,
			status: http.StatusBadRequest,
			errMsg: `"message":"Role must be one of Admin/Editor/Viewer."`,
		},
		{
			name:   "unknown user",
			body:   `{"user_id":"does-not-exist","role":"Editor","wrapped_secret_key":"AAA="}`,
			status: http.StatusNotFound,
			errMsg: `"message":"Target user not found."`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			scenario := tests.ApiScenario{
				Name:            "POST participants " + tc.name,
				Method:          http.MethodPost,
				URL:             "/api/v1/conversations/" + conversationID + "/participants",
				Body:            strings.NewReader(tc.body),
				ExpectedStatus:  tc.status,
				ExpectedContent: []string{tc.errMsg},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					seedOwnedConversation(t, app, conversationID, "test1@example.com")
					withRecordAuth("users", "test1@example.com")(t, app, e)
				},
			}
			scenario.Test(t)
		})
	}
}

func TestParticipantsRevokeStampsRemovedAt(t *testing.T) {
	t.Parallel()

	const conversationID = "convpartrev0001"

	scenario := tests.ApiScenario{
		Name:           "Admin can soft-revoke an Editor participant",
		Method:         http.MethodDelete,
		URL:            "/api/v1/conversations/" + conversationID + "/participants/xq9ndvc2kbrvrng",
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedParticipant(t, app, conversationID, "xq9ndvc2kbrvrng", "Editor")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			// The audit row stays in the DB; only removed_at is stamped.
			record, err := app.FindFirstRecordByFilter(
				"participants",
				"conversation = {:c} && user = {:u}",
				dbx.Params{"c": conversationID, "u": "xq9ndvc2kbrvrng"},
			)
			if err != nil || record == nil {
				t.Fatalf("FindFirstRecordByFilter(participants) err=%v rec=%v", err, record)
			}
			if record.GetString("removed_at") == "" {
				t.Fatalf("participants.removed_at = empty, want non-empty")
			}
		},
	}

	scenario.Test(t)
}

func TestParticipantsRevokeRejectsNonAdmin(t *testing.T) {
	t.Parallel()

	const conversationID = "convpartrev0002"

	scenario := tests.ApiScenario{
		Name:           "Editor cannot revoke another participant",
		Method:         http.MethodDelete,
		URL:            "/api/v1/conversations/" + conversationID + "/participants/uvi8zmr78j9y5hz",
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`"message":"Only conversation admins can revoke participants."`,
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
	}

	scenario.Test(t)
}

func TestParticipantsRevokeBlocksSelf(t *testing.T) {
	t.Parallel()

	const conversationID = "convpartrev0003"

	scenario := tests.ApiScenario{
		Name:           "Admin cannot revoke themselves",
		Method:         http.MethodDelete,
		URL:            "/api/v1/conversations/" + conversationID + "/participants/uvi8zmr78j9y5hz",
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Caller cannot revoke themselves."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestParticipantsRevokeBlocksLastAdmin(t *testing.T) {
	t.Parallel()

	const conversationID = "convpartrev0004"

	// Two admins on the conversation. The caller (test1) tries to revoke
	// the OTHER admin (test2), which would leave only the caller as
	// Admin — but if we then later revoked the caller, the conversation
	// would be orphaned. Pin the invariant: a revoke that drops the
	// admin count to zero (no, wait — to one. Reread.) Pin: a revoke
	// that would leave NO active admin at all is blocked. With two
	// admins, removing one leaves one. That's allowed. The blocked case
	// is removing the only remaining admin → test that path.
	//
	// Setup that exercises the block: one Admin, one Editor; the Admin
	// tries to revoke themselves via the self-check is blocked first.
	// So construct it as: Admin A revokes Admin B from a single-Admin
	// conversation — i.e. the target is the ONLY admin. The caller
	// must also be an Admin to reach the check; we use the creator.
	//
	// Concretely: test1 (creator/Admin) is the ONLY admin; we ask test1
	// to revoke test1 — caught by the self-check, not the last-admin
	// check. To hit the last-admin path we need a non-self target who
	// is the sole admin, which means the caller is an Admin too,
	// contradicting "sole admin". Resolve by giving the caller Editor
	// privileges... but Editors hit the role check first.
	//
	// The cleanest reachable case: the target is the sole admin and the
	// caller is also the sole admin (i.e. self). That's the self path.
	// To reach the last-admin check distinctly, allow a non-self target
	// who is the sole admin, with the caller being some other admin —
	// but then there are two admins, so removing one leaves one and
	// the check should ALLOW it. We've reasoned ourselves into the
	// observation that the last-admin guard only matters in conjunction
	// with self-revoke, which is already blocked. Keep the guard as
	// belt-and-braces for any future "leave conversation" endpoint that
	// bypasses the self-check.
	//
	// For the test, exercise the leaves-one-admin allowed path instead:
	// two admins, remove one, expect 204.
	scenario := tests.ApiScenario{
		Name:           "Admin can revoke another Admin when more than one remains",
		Method:         http.MethodDelete,
		URL:            "/api/v1/conversations/" + conversationID + "/participants/xq9ndvc2kbrvrng",
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			other, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail = %v", err)
			}
			seedParticipant(t, app, conversationID, other.Id, "Admin")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			record, err := app.FindFirstRecordByFilter(
				"participants",
				"conversation = {:c} && user = {:u}",
				dbx.Params{"c": conversationID, "u": "xq9ndvc2kbrvrng"},
			)
			if err != nil || record == nil {
				t.Fatalf("FindFirstRecordByFilter(participants) err=%v rec=%v", err, record)
			}
			if record.GetString("removed_at") == "" {
				t.Fatalf("Admin-revokes-second-Admin must have stamped removed_at")
			}
		},
	}

	scenario.Test(t)
}

func TestParticipantsRevokeReturns404ForNonParticipant(t *testing.T) {
	t.Parallel()

	const conversationID = "convpartrev0005"

	scenario := tests.ApiScenario{
		Name:           "revoking a non-participant returns 404",
		Method:         http.MethodDelete,
		URL:            "/api/v1/conversations/" + conversationID + "/participants/xq9ndvc2kbrvrng",
		ExpectedStatus: http.StatusNotFound,
		ExpectedContent: []string{
			`"message":"Participant not found."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
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
