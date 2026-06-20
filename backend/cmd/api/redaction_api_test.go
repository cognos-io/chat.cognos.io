package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// These tests pin the authenticated redaction HTTP contract at the handler
// layer: who can read/write the per-conversation redaction key and the sealed
// token→original mappings. The byte-level crypto round-trips live in the
// Playwright e2e suite; here we prove the participant authorization + 404/409
// boundaries against a real PocketBase, and that the server stores ciphertext.
//
// Seeded fixture user ids (stable in setupTestApp): test1 = uvi8zmr78j9y5hz
// (owner/Admin), test2 = xq9ndvc2kbrvrng (Editor).

const (
	redactionConversationID = "convredact00001"
	redactionTest1ID        = "uvi8zmr78j9y5hz"
	redactionTest2ID        = "xq9ndvc2kbrvrng"
	redactionToken          = "[[PII_EMAIL_ABC123]]"
	// 32-byte values base64-encode to 44 chars; the handlers never inspect the
	// bytes, so one valid placeholder serves every key/blob column.
	redactionB64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
)

// seedRedactionConversation builds a conversation owned by test1 (Admin) with
// test2 as an active Editor — the membership fixtures the redaction endpoints
// authorise against.
func seedRedactionConversation(t testing.TB, app *tests.TestApp) {
	t.Helper()
	seedOwnedConversation(t, app, redactionConversationID, "test1@example.com")
	seedParticipant(t, app, redactionConversationID, redactionTest2ID, "Editor")
}

func seedRedactionKey(t testing.TB, app *tests.TestApp, userID string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("conversation_redaction_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_redaction_keys) = %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("conversation", redactionConversationID)
	record.Set("user", userID)
	record.Set("key_version", 1)
	record.Set("public_key", redactionB64)
	record.Set("wrapped_secret_key", redactionB64)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(conversation_redaction_keys) = %v", err)
	}
}

func seedRedactionEntry(t testing.TB, app *tests.TestApp, token string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("redaction_entries")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(redaction_entries) = %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("conversation", redactionConversationID)
	record.Set("token", token)
	record.Set("key_version", 1)
	record.Set("data", redactionB64)
	record.Set("source_kind", "message")
	record.Set("source_id", "msg_seed")
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(redaction_entries) = %v", err)
	}
}

func TestConversationRedactionKeyAccess(t *testing.T) {
	t.Parallel()

	createBody := `{"public_key":"` + redactionB64 + `","keys":[` +
		`{"user_id":"` + redactionTest1ID + `","wrapped_secret_key":"` + redactionB64 + `"}]}`

	scenarios := []tests.ApiScenario{
		{
			Name:            "participant gets 404 before a redaction key exists",
			Method:          http.MethodGet,
			URL:             "/api/v1/conversations/" + redactionConversationID + "/redaction-key",
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"status":404`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
				withRecordAuth("users", "test1@example.com")(t, app, e)
			},
		},
		{
			Name:           "participant reads their wrapped redaction key",
			Method:         http.MethodGet,
			URL:            "/api/v1/conversations/" + redactionConversationID + "/redaction-key",
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				`"public_key":"` + redactionB64 + `"`,
				`"wrapped_secret_key":"` + redactionB64 + `"`,
				`"key_version":1`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
				seedRedactionKey(t, app, redactionTest1ID)
				withRecordAuth("users", "test1@example.com")(t, app, e)
			},
		},
		{
			Name:            "outsider gets 404 for the redaction key",
			Method:          http.MethodGet,
			URL:             "/api/v1/conversations/" + redactionConversationID + "/redaction-key",
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"status":404`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
				seedRedactionKey(t, app, redactionTest1ID)
				withRecordAuth("users", "no_data@example.com")(t, app, e)
			},
		},
		{
			Name:            "guest cannot read the redaction key",
			Method:          http.MethodGet,
			URL:             "/api/v1/conversations/" + redactionConversationID + "/redaction-key",
			ExpectedStatus:  http.StatusUnauthorized,
			ExpectedContent: []string{`"status":401`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
			},
		},
		{
			Name:            "participant creates the redaction key",
			Method:          http.MethodPost,
			URL:             "/api/v1/conversations/" + redactionConversationID + "/redaction-key",
			Body:            strings.NewReader(createBody),
			ExpectedStatus:  http.StatusCreated,
			ExpectedContent: []string{`"key_version":1`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
				withRecordAuth("users", "test1@example.com")(t, app, e)
			},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row, err := app.FindFirstRecordByFilter(
					"conversation_redaction_keys",
					"conversation = {:c} && user = {:u} && key_version = 1",
					dbx.Params{"c": redactionConversationID, "u": redactionTest1ID},
				)
				if err != nil || row == nil {
					t.Fatalf("expected a v1 redaction key for test1, err=%v rec=%v", err, row)
				}
			},
		},
		{
			Name:            "creating a second redaction key for the generation is a 409",
			Method:          http.MethodPost,
			URL:             "/api/v1/conversations/" + redactionConversationID + "/redaction-key",
			Body:            strings.NewReader(createBody),
			ExpectedStatus:  http.StatusConflict,
			ExpectedContent: []string{`"status":409`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
				seedRedactionKey(t, app, redactionTest1ID)
				withRecordAuth("users", "test1@example.com")(t, app, e)
			},
		},
		{
			Name:   "rejects a wrapped key for a non-participant",
			Method: http.MethodPost,
			URL:    "/api/v1/conversations/" + redactionConversationID + "/redaction-key",
			Body: strings.NewReader(`{"public_key":"` + redactionB64 + `","keys":[` +
				`{"user_id":"` + redactionTest1ID + `","wrapped_secret_key":"` + redactionB64 + `"},` +
				`{"user_id":"notaparticipant","wrapped_secret_key":"` + redactionB64 + `"}]}`),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"status":400`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
				withRecordAuth("users", "test1@example.com")(t, app, e)
			},
		},
		{
			Name:   "rejects creation that omits the caller",
			Method: http.MethodPost,
			URL:    "/api/v1/conversations/" + redactionConversationID + "/redaction-key",
			Body: strings.NewReader(`{"public_key":"` + redactionB64 + `","keys":[` +
				`{"user_id":"` + redactionTest2ID + `","wrapped_secret_key":"` + redactionB64 + `"}]}`),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"status":400`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
				withRecordAuth("users", "test1@example.com")(t, app, e)
			},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestConversationRedactionEntriesAccess(t *testing.T) {
	t.Parallel()

	createBody := `{"entries":[{"token":"` + redactionToken +
		`","data":"` + redactionB64 + `","source_kind":"message","source_id":"msg_1"}]}`

	scenarios := []tests.ApiScenario{
		{
			Name:           "participant creates a redaction entry storing only ciphertext",
			Method:         http.MethodPost,
			URL:            "/api/v1/conversations/" + redactionConversationID + "/redaction-entries",
			Body:           strings.NewReader(createBody),
			ExpectedStatus: http.StatusCreated,
			ExpectedContent: []string{
				`"created":["` + redactionToken + `"]`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
				withRecordAuth("users", "test2@example.com")(t, app, e)
			},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row, err := app.FindFirstRecordByFilter(
					"redaction_entries",
					"conversation = {:c} && token = {:t}",
					dbx.Params{"c": redactionConversationID, "t": redactionToken},
				)
				if err != nil || row == nil {
					t.Fatalf("expected stored entry, err=%v rec=%v", err, row)
				}
				if got := row.GetString("data"); got != redactionB64 {
					t.Fatalf("data = %q, want ciphertext placeholder", got)
				}
			},
		},
		{
			Name:           "re-posting an existing token is idempotent",
			Method:         http.MethodPost,
			URL:            "/api/v1/conversations/" + redactionConversationID + "/redaction-entries",
			Body:           strings.NewReader(createBody),
			ExpectedStatus: http.StatusCreated,
			ExpectedContent: []string{
				`"created":[]`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
				seedRedactionEntry(t, app, redactionToken)
				withRecordAuth("users", "test1@example.com")(t, app, e)
			},
		},
		{
			Name:           "participant lists redaction entries",
			Method:         http.MethodGet,
			URL:            "/api/v1/conversations/" + redactionConversationID + "/redaction-entries",
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				`"token":"` + redactionToken + `"`,
				`"data":"` + redactionB64 + `"`,
				`"source_kind":"message"`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
				seedRedactionEntry(t, app, redactionToken)
				withRecordAuth("users", "test1@example.com")(t, app, e)
			},
		},
		{
			Name:            "outsider cannot list redaction entries",
			Method:          http.MethodGet,
			URL:             "/api/v1/conversations/" + redactionConversationID + "/redaction-entries",
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"status":404`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
				seedRedactionEntry(t, app, redactionToken)
				withRecordAuth("users", "no_data@example.com")(t, app, e)
			},
		},
		{
			Name:            "guest cannot create redaction entries",
			Method:          http.MethodPost,
			URL:             "/api/v1/conversations/" + redactionConversationID + "/redaction-entries",
			Body:            strings.NewReader(createBody),
			ExpectedStatus:  http.StatusUnauthorized,
			ExpectedContent: []string{`"status":401`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedRedactionConversation(t, app)
			},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}
