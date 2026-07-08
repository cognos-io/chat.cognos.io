package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// These tests pin the authorization boundaries of the bookmarks routes.
// Bookmarks are owner-only (like user memory) and creation is additionally gated
// by conversation access. A non-owner must get the same neutral 404 a missing
// record returns, so ids can't be probed. The ciphertext round-trips are covered
// by the Playwright e2e (bookmarks-api.spec.ts); here we prove the owner denial
// boundaries + conversation-access gate against a real PocketBase.

const (
	bmkConvID       = "bkmkconv0000001"
	bmkOtherConvID  = "bkmkconv0000002"
	bmkOwnerRecID   = "bkmkrec00000001"
	bmkOtherRecID   = "bkmkrec00000002"
	bmkMessageID    = "bkmkmsg00000001"
	bmkDataB64      = "Ym9va21hcmtjaXBo"
	bmkOtherDataB64 = "b3RoZXJib29rbWtj"
)

func seedBookmark(
	t testing.TB,
	app *tests.TestApp,
	id, ownerEmail, conversationID, message, data string,
) {
	t.Helper()
	owner, err := app.FindAuthRecordByEmail("users", ownerEmail)
	if err != nil {
		t.Fatal(err)
	}
	collection, err := app.FindCollectionByNameOrId("user_bookmarks")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(user_bookmarks) = %v", err)
	}
	record := core.NewRecord(collection)
	record.Id = id
	record.Set("user", owner.Id)
	record.Set("conversation", conversationID)
	record.Set("message", message)
	record.Set("data", data)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(user_bookmarks) = %v", err)
	}
}

// TestBookmarkCreate covers the create happy path (owner + accessible
// conversation), the validation failures, and the conversation-access gate.
func TestBookmarkCreate(t *testing.T) {
	t.Parallel()

	// test1 owns bmkConvID (as an Admin participant); test2 does not.
	seed := func(email string) func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		return func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, bmkConvID, "test1@example.com")
			bindAuthAs(t, app, e, email)
		}
	}

	scenarios := []tests.ApiScenario{
		{
			Name:   "owner creates a bookmark on an accessible conversation",
			Method: http.MethodPost,
			URL:    "/api/v1/bookmarks",
			Body: strings.NewReader(
				`{"conversation":"` + bmkConvID + `","message":"` + bmkMessageID + `","data":"` + bmkDataB64 + `"}`,
			),
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				`"data":"` + bmkDataB64 + `"`,
				`"conversation":"` + bmkConvID + `"`,
				`"message":"` + bmkMessageID + `"`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: seed("test1@example.com"),
		},
		{
			Name:            "create without data is a 400",
			Method:          http.MethodPost,
			URL:             "/api/v1/bookmarks",
			Body:            strings.NewReader(`{"conversation":"` + bmkConvID + `","message":"` + bmkMessageID + `"}`),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{"Data is required"},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seed("test1@example.com"),
		},
		{
			Name:            "create without conversation is a 400",
			Method:          http.MethodPost,
			URL:             "/api/v1/bookmarks",
			Body:            strings.NewReader(`{"message":"` + bmkMessageID + `","data":"` + bmkDataB64 + `"}`),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{"Conversation is required"},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seed("test1@example.com"),
		},
		{
			Name:            "create without message is a 400",
			Method:          http.MethodPost,
			URL:             "/api/v1/bookmarks",
			Body:            strings.NewReader(`{"conversation":"` + bmkConvID + `","data":"` + bmkDataB64 + `"}`),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{"Message is required"},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seed("test1@example.com"),
		},
		{
			Name:   "create on an inaccessible conversation is a neutral 404",
			Method: http.MethodPost,
			URL:    "/api/v1/bookmarks",
			Body: strings.NewReader(
				`{"conversation":"` + bmkConvID + `","message":"` + bmkMessageID + `","data":"` + bmkDataB64 + `"}`,
			),
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{"Conversation not found"},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seed("test2@example.com"),
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// TestBookmarkOwnerScoped proves bookmarks are readable/deletable only by their
// owner: the list excludes other users' rows (and honours the ?conversation
// filter), and delete of a foreign row is an indistinguishable 404.
func TestBookmarkOwnerScoped(t *testing.T) {
	t.Parallel()

	// test1 owns bmkOwnerRecID on bmkConvID; test2 owns a separate row.
	seedBoth := func(email string) func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		return func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, bmkConvID, "test1@example.com")
			seedOwnedConversation(t, app, bmkOtherConvID, "test1@example.com")
			seedBookmark(t, app, bmkOwnerRecID, "test1@example.com", bmkConvID, bmkMessageID, bmkDataB64)
			seedBookmark(t, app, "bkmkrec00000003", "test1@example.com", bmkOtherConvID, bmkMessageID, "b3RoZXJjb252Ym1r")
			seedBookmark(t, app, bmkOtherRecID, "test2@example.com", bmkConvID, bmkMessageID, bmkOtherDataB64)
			bindAuthAs(t, app, e, email)
		}
	}

	scenarios := []tests.ApiScenario{
		{
			Name:            "list returns only the caller's rows",
			Method:          http.MethodGet,
			URL:             "/api/v1/bookmarks",
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"data":"` + bmkDataB64 + `"`},
			NotExpectedContent: []string{
				`"data":"` + bmkOtherDataB64 + `"`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: seedBoth("test1@example.com"),
		},
		{
			Name:            "list honours the ?conversation filter",
			Method:          http.MethodGet,
			URL:             "/api/v1/bookmarks?conversation=" + bmkConvID,
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"data":"` + bmkDataB64 + `"`},
			NotExpectedContent: []string{
				`"data":"b3RoZXJjb252Ym1r"`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: seedBoth("test1@example.com"),
		},
		{
			Name:            "delete by a non-owner is 404",
			Method:          http.MethodDelete,
			URL:             "/api/v1/bookmarks/" + bmkOwnerRecID,
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{"Bookmark not found"},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seedBoth("test2@example.com"),
		},
		{
			Name:           "delete by the owner is 204",
			Method:         http.MethodDelete,
			URL:            "/api/v1/bookmarks/" + bmkOwnerRecID,
			ExpectedStatus: http.StatusNoContent,
			TestAppFactory: setupTestApp,
			BeforeTestFunc: seedBoth("test1@example.com"),
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}
