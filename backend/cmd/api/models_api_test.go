package main

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestModelsGetRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "models route requires record auth",
		Method:         http.MethodGet,
		URL:            "/api/v1/models",
		ExpectedStatus: http.StatusUnauthorized,
		ExpectedContent: []string{
			`"message":"The request requires valid record authorization token."`,
		},
		TestAppFactory: setupTestApp,
	}

	scenario.Test(t)
}

func TestModelsGetReturnsActiveModels(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "models route returns backend catalogue",
		Method:         http.MethodGet,
		URL:            "/api/v1/models",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"privacy_tier":"eu"`,
			`"id":"llama-3-3-infomaniak"`,
			`"provider_id":"infomaniak"`,
			`"is_eligible":true`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestModelsGetUsesUserPrivacyTierWhenPresent(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "models route uses user privacy tier from auth record",
		Method:         http.MethodGet,
		URL:            "/api/v1/models",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"privacy_tier":"ch_only"`,
			`"id":"llama-3-3-infomaniak"`,
			`"is_eligible":true`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(users, test1@example.com) error = %v", err)
			}
			record.Set("privacy_tier", "ch_only")
			e.Router.BindFunc(func(re *core.RequestEvent) error {
				re.Auth = record
				return re.Next()
			})
		},
	}

	scenario.Test(t)
}

func TestModelsGetReturnsPreferredModelIDWhenPresent(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "models route returns preferred model id from auth record",
		Method:         http.MethodGet,
		URL:            "/api/v1/models",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"preferred_model_id":"llama-3-3-infomaniak"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(users, test1@example.com) error = %v", err)
			}
			record.Set("preferred_model_id", "llama-3-3-infomaniak")
			e.Router.BindFunc(func(re *core.RequestEvent) error {
				re.Auth = record
				return re.Next()
			})
		},
	}

	scenario.Test(t)
}

func TestModelsGetDefaultsUnknownPrivacyTierToEU(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "models route defaults unknown privacy tier to eu",
		Method:         http.MethodGet,
		URL:            "/api/v1/models",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"privacy_tier":"eu"`,
			`"is_eligible":true`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(users, test1@example.com) error = %v", err)
			}
			record.Set("privacy_tier", "legacy")
			e.Router.BindFunc(func(re *core.RequestEvent) error {
				re.Auth = record
				return re.Next()
			})
		},
	}

	scenario.Test(t)
}
