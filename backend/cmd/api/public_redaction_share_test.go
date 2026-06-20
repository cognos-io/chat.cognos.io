package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// These tests pin the two-mode public-sharing contract for PII redaction
// (spec §6.6): a redacted-only share can never reach the mappings, while an
// include-sensitive share exposes the sealed redaction key material plus the
// encrypted entries. The byte-level decryption is covered by the browser e2e
// suite; here we prove the server-side isolation boundary.

const (
	pubRedConversationID = "convpubred00001"
	pubRedB64            = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	pubRedToken          = "pubredincludetoken00000000000001"
	pubRedOnlyToken      = "pubredredactedonlytoken000000001"
)

// seedPublicRedactionShare builds a conversation with a v1 public key, one
// redaction entry, and a public share in the given mode.
func seedPublicRedactionShare(t testing.TB, app *tests.TestApp, token, mode string) {
	t.Helper()
	seedOwnedConversation(t, app, pubRedConversationID, "test1@example.com")

	pkCollection, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) = %v", err)
	}
	pk := core.NewRecord(pkCollection)
	pk.Set("conversation", pubRedConversationID)
	pk.Set("public_key", pubRedB64)
	pk.Set("public_key_signature", pubRedB64)
	pk.Set("key_version", 1)
	if err := app.Save(pk); err != nil {
		t.Fatalf("Save(public key) = %v", err)
	}

	entryCollection, err := app.FindCollectionByNameOrId("redaction_entries")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(redaction_entries) = %v", err)
	}
	entry := core.NewRecord(entryCollection)
	entry.Set("conversation", pubRedConversationID)
	entry.Set("token", "[[PII_EMAIL_PUB001]]")
	entry.Set("key_version", 1)
	entry.Set("data", pubRedB64)
	entry.Set("source_kind", "message")
	if err := app.Save(entry); err != nil {
		t.Fatalf("Save(redaction entry) = %v", err)
	}

	shareCollection, err := app.FindCollectionByNameOrId("conversation_public_shares")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_shares) = %v", err)
	}
	share := core.NewRecord(shareCollection)
	share.Set("conversation", pubRedConversationID)
	share.Set("token", token)
	share.Set("public_key", pubRedB64)
	share.Set("wrapped_conversation_secret_key", pubRedB64)
	share.Set("share_secret", pubRedB64)
	share.Set("key_version", 1)
	share.Set("mode", mode)
	if mode == "include_sensitive" {
		share.Set("wrapped_redaction_secret_key", pubRedB64)
		share.Set("redaction_public_key", pubRedB64)
	}
	if err := app.Save(share); err != nil {
		t.Fatalf("Save(public share) = %v", err)
	}
}

func TestPublicRedactionShareModes(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:           "include-sensitive share exposes redaction key material",
			Method:         http.MethodGet,
			URL:            "/api/v1/public/conversations/" + pubRedToken,
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				`"mode":"include_sensitive"`,
				`"wrapped_redaction_secret_key":"` + pubRedB64 + `"`,
				`"redaction_public_key":"` + pubRedB64 + `"`,
			},
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				app := setupTestApp(t)
				seedPublicRedactionShare(t, app, pubRedToken, "include_sensitive")
				return app
			},
		},
		{
			Name:           "include-sensitive share returns the encrypted entries",
			Method:         http.MethodGet,
			URL:            "/api/v1/public/conversations/" + pubRedToken + "/redaction-entries",
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				`"token":"[[PII_EMAIL_PUB001]]"`,
				`"data":"` + pubRedB64 + `"`,
			},
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				app := setupTestApp(t)
				seedPublicRedactionShare(t, app, pubRedToken, "include_sensitive")
				return app
			},
		},
		{
			Name:           "redacted-only share never returns redaction key material",
			Method:         http.MethodGet,
			URL:            "/api/v1/public/conversations/" + pubRedOnlyToken,
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				`"mode":"redacted_only"`,
			},
			NotExpectedContent: []string{
				"wrapped_redaction_secret_key",
				"redaction_public_key",
			},
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				app := setupTestApp(t)
				seedPublicRedactionShare(t, app, pubRedOnlyToken, "redacted_only")
				return app
			},
		},
		{
			Name:            "redacted-only share cannot reach the mappings (404)",
			Method:          http.MethodGet,
			URL:             "/api/v1/public/conversations/" + pubRedOnlyToken + "/redaction-entries",
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"status":404`},
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				app := setupTestApp(t)
				seedPublicRedactionShare(t, app, pubRedOnlyToken, "redacted_only")
				return app
			},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestPublicShareIncludeSensitiveRequiresKeyMaterial(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:   "include-sensitive create without redaction key material is rejected",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + pubRedConversationID + "/public-share",
		Body: strings.NewReader(`{"public_key":"` + pubRedB64 +
			`","wrapped_conversation_secret_key":"` + pubRedB64 +
			`","share_secret":"` + pubRedB64 +
			`","mode":"include_sensitive"}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{`"status":400`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, pubRedConversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}
