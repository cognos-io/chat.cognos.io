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
			Name:           "metrics route works on fresh app " + string(rune('1'+i)),
			Method:         http.MethodGet,
			URL:            "/metrics",
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				"cognos_chat_users",
				"process_cpu_seconds_total",
			},
			TestAppFactory: setupTestApp,
		}

		scenario.Test(t)
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
		},
	}

	scenario.Test(t)
}
