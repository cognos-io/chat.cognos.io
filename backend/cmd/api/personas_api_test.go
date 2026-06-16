package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// The persona payload is opaque, base64-encoded ciphertext. The collection's
// `data` field enforces a base64 pattern, so tests use real base64 values.
const personaCiphertext = "QUJDRA==" // base64("ABCD")

func TestPersonasListReturnsEmptyForNewUser(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "personas list returns empty items for a user with none",
		Method:          http.MethodGet,
		URL:             "/api/v1/personas",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"items":[]`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestPersonasListRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "personas list rejects unauthenticated callers",
		Method:          http.MethodGet,
		URL:             "/api/v1/personas",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{"authorization token"},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

func TestPersonasCreateStoresEncryptedDataForOwner(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "personas create stores the owner and encrypted data",
		Method:         http.MethodPost,
		URL:            "/api/v1/personas",
		Body:           strings.NewReader(`{"data":"` + personaCiphertext + `"}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"user":"uvi8zmr78j9y5hz"`,
			`"data":"` + personaCiphertext + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestPersonasCreateRejectsMissingData(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "personas create rejects an empty data payload",
		Method:          http.MethodPost,
		URL:             "/api/v1/personas",
		Body:            strings.NewReader(`{"data":""}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"is required"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

// Listing a user's personas after one is created must round-trip the stored
// ciphertext and exclude personas owned by other users.
func TestPersonasListReturnsOnlyOwnerRecords(t *testing.T) {
	t.Parallel()

	seedPersona := func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		collection, err := app.FindCollectionByNameOrId("personas")
		if err != nil {
			t.Fatalf("FindCollectionByNameOrId(personas) error = %v", err)
		}

		owned := core.NewRecord(collection)
		owned.Set("user", "uvi8zmr78j9y5hz")
		owned.Set("data", personaCiphertext)
		if err := app.Save(owned); err != nil {
			t.Fatalf("Save(owned persona) error = %v", err)
		}

		foreign := core.NewRecord(collection)
		foreign.Set("user", "xq9ndvc2kbrvrng")
		foreign.Set("data", "WFlaWg==")
		if err := app.Save(foreign); err != nil {
			t.Fatalf("Save(foreign persona) error = %v", err)
		}

		record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
		if err != nil {
			t.Fatal(err)
		}
		e.Router.BindFunc(func(re *core.RequestEvent) error {
			re.Auth = record
			return re.Next()
		})
	}

	scenario := tests.ApiScenario{
		Name:           "personas list returns only the caller's personas",
		Method:         http.MethodGet,
		URL:            "/api/v1/personas",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"data":"` + personaCiphertext + `"`,
			`"user":"uvi8zmr78j9y5hz"`,
		},
		NotExpectedContent: []string{
			`"data":"WFlaWg=="`,
			`"user":"xq9ndvc2kbrvrng"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: seedPersona,
	}

	scenario.Test(t)
}
