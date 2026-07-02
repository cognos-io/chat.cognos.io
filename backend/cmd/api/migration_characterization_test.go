package main

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestLegacyChatCompletionsRouteNotFound(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:   "legacy chat completions route is not registered",
		Method: http.MethodPost,
		URL:    "/v1/chat/completions",
		Body: strings.NewReader(`{
			"model": "openai:gpt-4o",
			"messages": [{"role": "user", "content": "hello"}]
		}`),
		ExpectedStatus: http.StatusNotFound,
		ExpectedContent: []string{
			`"message":"The requested resource wasn't found."`,
		},
		TestAppFactory: setupTestApp,
	}

	scenario.Test(t)
}

func TestMetricsRouteWorksAcrossFreshApps(t *testing.T) {
	t.Parallel()

	for i := range 2 {
		scenario := tests.ApiScenario{
			Name:           "metrics route works for superusers on fresh app " + string(rune('1'+i)),
			Method:         http.MethodGet,
			URL:            "/metrics",
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				"cognos_chat_users",
				"process_cpu_seconds_total",
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withSuperuserAuth(),
		}

		scenario.Test(t)
	}
}

// /metrics exposes operational counters (user/conversation/message totals) —
// operator data, not user data. It must be superuser-only: a regular
// authenticated user is 403'd and an anonymous caller is 401'd.
func TestMetricsRouteRejectsNonSuperusers(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:           "metrics rejects a regular authenticated user",
			Method:         http.MethodGet,
			URL:            "/metrics",
			ExpectedStatus: http.StatusForbidden,
			ExpectedContent: []string{
				`"message":"The authorized record is not allowed to perform this action."`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		},
		{
			Name:           "metrics rejects anonymous callers",
			Method:         http.MethodGet,
			URL:            "/metrics",
			ExpectedStatus: http.StatusUnauthorized,
			ExpectedContent: []string{
				`"message":"The request requires valid record authorization token."`,
			},
			TestAppFactory: setupTestApp,
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// withSuperuserAuth seeds a superuser record and authenticates the request as
// it (the test seed data deliberately contains no superusers).
func withSuperuserAuth() func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
	return func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		collection, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
		if err != nil {
			t.Fatal(err)
		}

		record := core.NewRecord(collection)
		record.Set("email", "superuser@example.com")
		record.SetPassword("password-1234")
		if err := app.Save(record); err != nil {
			t.Fatal(err)
		}

		e.Router.BindFunc(func(re *core.RequestEvent) error {
			re.Auth = record
			return re.Next()
		})
	}
}

// TestLegacyModelsCollectionRetired pins migration 1760000021: the old
// database-driven `models` collection is gone after migrations run, leaving
// the Go-defined catalogue (internal/catalogue) as the single source of
// truth surfaced by GET /api/v1/models.
func TestLegacyModelsCollectionRetired(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	if _, err := app.FindCollectionByNameOrId("models"); err == nil {
		t.Fatal("FindCollectionByNameOrId(models) returned no error, want collection deleted")
	}
}

func TestSoftDeleteCopiesDeletedRecord(t *testing.T) {
	t.Parallel()

	const recordID = "softdelpref0001"

	withUserToken := withRecordAuth("users", "test1@example.com")

	scenario := tests.ApiScenario{
		Name:           "delete user preference keeps deleted copy",
		Method:         http.MethodDelete,
		URL:            "/api/collections/user_preferences/records/" + recordID,
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withUserToken(t, app, e)

			collection, err := app.FindCollectionByNameOrId("user_preferences")
			if err != nil {
				t.Fatalf("FindCollectionByNameOrId(user_preferences) error = %v", err)
			}

			record := core.NewRecord(collection)
			record.Id = recordID
			record.Set("user", "uvi8zmr78j9y5hz")
			record.Set("data", base64.StdEncoding.EncodeToString([]byte(`{"theme":"dark"}`)))

			if err := app.Save(record); err != nil {
				t.Fatalf("Save(%q) error = %v", recordID, err)
			}
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			deletedRecords, err := app.FindRecordsByFilter(
				"deleted",
				"collection = {:collection}",
				"",
				10,
				0,
				dbx.Params{"collection": "user_preferences"},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(deleted) error = %v", err)
			}

			if len(deletedRecords) == 0 {
				t.Fatal("FindRecordsByFilter(deleted) returned no deleted records")
			}

			if got := deletedRecords[0].GetString("collection"); got != "user_preferences" {
				t.Fatalf("deletedRecords[0].GetString(collection) = %q, want %q", got, "user_preferences")
			}

			if got := deletedRecords[0].GetString("record"); !strings.Contains(got, `"id":"`+recordID+`"`) {
				t.Fatalf("deletedRecords[0].GetString(record) = %q, want record JSON containing deleted id %q", got, recordID)
			}

			if got := deletedRecords[0].GetDateTime("deleted_at"); got.IsZero() {
				t.Fatal("deletedRecords[0].GetDateTime(deleted_at) unexpectedly zero")
			}
		},
	}

	scenario.Test(t)
}
