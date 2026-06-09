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
	// Subtests share the test user so the rate limiter sees them as one
	// burst when run in parallel; keep them sequential to avoid flakey
	// 429s while still covering each validation branch.

	cases := []struct {
		name   string
		convID string
		body   string
		status int
		errMsg string
	}{
		{
			name:   "missing user_id",
			convID: "convpartadd0040",
			body:   `{"role":"Editor","wrapped_secret_key":"AAA="}`,
			// PocketBase's apis.NewBadRequestError auto-capitalizes the
			// first letter of the message when serialized, hence the
			// "User_id" / "Wrapped_secret_key" expectations below.
			status: http.StatusBadRequest,
			errMsg: `"message":"User_id is required."`,
		},
		{
			name:   "missing wrapped_secret_key",
			convID: "convpartadd0041",
			body:   `{"user_id":"xq9ndvc2kbrvrng","role":"Editor"}`,
			status: http.StatusBadRequest,
			errMsg: `"message":"Wrapped_secret_key is required."`,
		},
		{
			name:   "invalid role",
			convID: "convpartadd0042",
			body:   `{"user_id":"xq9ndvc2kbrvrng","role":"Sysadmin","wrapped_secret_key":"AAA="}`,
			status: http.StatusBadRequest,
			errMsg: `"message":"Role must be one of Admin/Editor/Viewer."`,
		},
		{
			name:   "unknown user",
			convID: "convpartadd0043",
			body:   `{"user_id":"does-not-exist","role":"Editor","wrapped_secret_key":"AAA="}`,
			status: http.StatusNotFound,
			errMsg: `"message":"Target user not found."`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			conversationID := tc.convID
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

func TestParticipantsAddReactivatesSoftRevokedRow(t *testing.T) {
	t.Parallel()

	const conversationID = "convreadd000001"
	const targetUser = "xq9ndvc2kbrvrng"

	// A previously-revoked participant (row with removed_at stamped) must
	// be re-addable. Without the re-activation path, the UNIQUE(conversation,
	// user) index would 500 the insert. Verify the row is mutated in place:
	// removed_at cleared, role refreshed, added_at refreshed.
	scenario := tests.ApiScenario{
		Name:   "Re-adding a soft-revoked participant re-activates the row",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/participants",
		Body: strings.NewReader(`{
			"user_id": "` + targetUser + `",
			"role": "Viewer",
			"wrapped_secret_key": "RE-ADDED-WRAPPED-SECRET====================="
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"role":"Viewer"`,
			`"user_id":"` + targetUser + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedParticipant(t, app, conversationID, targetUser, "Editor")
			revokeParticipant(t, app, conversationID, targetUser)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			rows, err := app.FindRecordsByFilter(
				"participants",
				"conversation = {:c} && user = {:u}",
				"",
				10, 0,
				dbx.Params{"c": conversationID, "u": targetUser},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter err=%v", err)
			}
			if len(rows) != 1 {
				t.Fatalf("expected 1 participants row (re-activated), got %d", len(rows))
			}
			if got := rows[0].GetString("removed_at"); got != "" {
				t.Fatalf("removed_at = %q after re-add, want empty", got)
			}
			if got := rows[0].GetString("role"); got != "Viewer" {
				t.Fatalf("role = %q after re-add, want Viewer", got)
			}
		},
	}
	scenario.Test(t)
}

func TestParticipantsAddRejectsAlreadyActive(t *testing.T) {
	t.Parallel()

	const conversationID = "convdupadd00001"
	const targetUser = "xq9ndvc2kbrvrng"

	scenario := tests.ApiScenario{
		Name:   "Adding an already-active participant returns a focused 400",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/participants",
		Body: strings.NewReader(`{
			"user_id": "` + targetUser + `",
			"role": "Editor",
			"wrapped_secret_key": "ANYTHING===================================="
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"User is already an active participant."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedParticipant(t, app, conversationID, targetUser, "Editor")
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
