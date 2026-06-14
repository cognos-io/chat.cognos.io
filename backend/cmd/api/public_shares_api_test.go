package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// These tests pin the public-sharing HTTP contract at the handler layer:
//   - the /api/v1/public/* surface is reachable WITHOUT auth, gated only by a
//     valid share token (a bad token is an indistinguishable 404),
//   - the participant-facing share lookup is 404 for non-participants,
//   - minting a share is Admin-only.
// The byte-level crypto round-trips live in the Playwright e2e suite; here we
// prove the authorization + 404 boundaries against a real PocketBase.

const (
	shareConversationID = "cpsapitest00001"
	shareToken          = "publicsharetokenabcdef0123456789"
	shareMessageID      = "cpsapimsg000001"
	// 32-byte values base64-encode to 44 chars; reuse a valid placeholder for
	// every key/blob column (the handlers never inspect the bytes).
	shareB64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
)

// seedPublicShareScenarioApp builds a conversation owned by test1 (Admin) with
// test2 as an active Editor, a conversation public key at v1, a public-share
// row at a known token, and one message — the fixtures the public endpoints
// read from.
func seedPublicShareScenarioApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app := setupTestApp(t)

	seedOwnedConversation(t, app, shareConversationID, "test1@example.com")

	// test2 is an active Editor — used to prove non-admins can't mint a share.
	editor, err := app.FindAuthRecordByEmail("users", "test2@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(test2) = %v", err)
	}
	seedParticipant(t, app, shareConversationID, editor.Id, "Editor")

	publicKeyCollection, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) = %v", err)
	}
	pk := core.NewRecord(publicKeyCollection)
	pk.Set("conversation", shareConversationID)
	pk.Set("public_key", shareB64)
	pk.Set("public_key_signature", shareB64)
	pk.Set("key_version", 1)
	if err := app.Save(pk); err != nil {
		t.Fatalf("Save(conversation_public_keys) = %v", err)
	}

	shareCollection, err := app.FindCollectionByNameOrId("conversation_public_shares")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_shares) = %v", err)
	}
	share := core.NewRecord(shareCollection)
	share.Set("conversation", shareConversationID)
	share.Set("token", shareToken)
	share.Set("public_key", shareB64)
	share.Set("wrapped_conversation_secret_key", shareB64)
	share.Set("share_secret", shareB64)
	share.Set("key_version", 1)
	if err := app.Save(share); err != nil {
		t.Fatalf("Save(conversation_public_shares) = %v", err)
	}

	seedMessage(t, app, shareMessageID, shareConversationID, false)

	return app
}

func TestPublicConversationEndpointsNoAuth(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:           "public conversation by token is readable without auth",
			Method:         http.MethodGet,
			URL:            "/api/v1/public/conversations/" + shareToken,
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				`"conversation_id":"` + shareConversationID + `"`,
				`"conversation_public_key":"` + shareB64 + `"`,
				`"key_version":1`,
			},
			TestAppFactory: seedPublicShareScenarioApp,
		},
		{
			Name:            "public conversation with an unknown token is 404",
			Method:          http.MethodGet,
			URL:             "/api/v1/public/conversations/totallyunknowntoken00000000000000",
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"status":404`},
			TestAppFactory:  seedPublicShareScenarioApp,
		},
		{
			Name:           "public messages by token are readable without auth",
			Method:         http.MethodGet,
			URL:            "/api/v1/public/conversations/" + shareToken + "/messages",
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				`"totalItems":1`,
				`"id":"` + shareMessageID + `"`,
			},
			TestAppFactory: seedPublicShareScenarioApp,
		},
		{
			Name:            "public messages with an unknown token is 404",
			Method:          http.MethodGet,
			URL:             "/api/v1/public/conversations/totallyunknowntoken00000000000000/messages",
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"status":404`},
			TestAppFactory:  seedPublicShareScenarioApp,
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestConversationPublicShareAuthz(t *testing.T) {
	t.Parallel()

	createBody := `{"public_key":"` + shareB64 +
		`","wrapped_conversation_secret_key":"` + shareB64 +
		`","share_secret":"` + shareB64 + `"}`

	scenarios := []tests.ApiScenario{
		{
			Name:           "owner (Admin) can read the share record",
			Method:         http.MethodGet,
			URL:            "/api/v1/conversations/" + shareConversationID + "/public-share",
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				`"token":"` + shareToken + `"`,
				`"share_secret":"` + shareB64 + `"`,
			},
			TestAppFactory: seedPublicShareScenarioApp,
			BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		},
		{
			Name:            "active Editor can read the share record",
			Method:          http.MethodGet,
			URL:             "/api/v1/conversations/" + shareConversationID + "/public-share",
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"token":"` + shareToken + `"`},
			TestAppFactory:  seedPublicShareScenarioApp,
			BeforeTestFunc:  withRecordAuth("users", "test2@example.com"),
		},
		{
			Name:            "outsider gets 404 for the share record",
			Method:          http.MethodGet,
			URL:             "/api/v1/conversations/" + shareConversationID + "/public-share",
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"status":404`},
			TestAppFactory:  seedPublicShareScenarioApp,
			BeforeTestFunc:  withRecordAuth("users", "no_data@example.com"),
		},
		{
			Name:            "guest cannot read the share record",
			Method:          http.MethodGet,
			URL:             "/api/v1/conversations/" + shareConversationID + "/public-share",
			ExpectedStatus:  http.StatusUnauthorized,
			ExpectedContent: []string{`"status":401`},
			TestAppFactory:  seedPublicShareScenarioApp,
		},
		{
			Name:            "active Editor cannot mint a share (admin-only)",
			Method:          http.MethodPost,
			URL:             "/api/v1/conversations/" + shareConversationID + "/public-share",
			Body:            strings.NewReader(createBody),
			ExpectedStatus:  http.StatusForbidden,
			ExpectedContent: []string{`"status":403`},
			TestAppFactory:  seedPublicShareScenarioApp,
			BeforeTestFunc:  withRecordAuth("users", "test2@example.com"),
		},
		{
			Name:            "outsider cannot mint a share",
			Method:          http.MethodPost,
			URL:             "/api/v1/conversations/" + shareConversationID + "/public-share",
			Body:            strings.NewReader(createBody),
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"status":404`},
			TestAppFactory:  seedPublicShareScenarioApp,
			BeforeTestFunc:  withRecordAuth("users", "no_data@example.com"),
		},
		{
			Name:            "guest cannot mint a share",
			Method:          http.MethodPost,
			URL:             "/api/v1/conversations/" + shareConversationID + "/public-share",
			Body:            strings.NewReader(createBody),
			ExpectedStatus:  http.StatusUnauthorized,
			ExpectedContent: []string{`"status":401`},
			TestAppFactory:  seedPublicShareScenarioApp,
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}
