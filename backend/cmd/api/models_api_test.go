package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
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

func TestPublicModelsGetReturnsNamesWithoutAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "public models route returns id and name without auth",
		Method:         http.MethodGet,
		URL:            "/api/v1/public/models",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"llama-3-3-infomaniak"`,
			`"name":"Llama 3.3"`,
		},
		NotExpectedContent: []string{
			// Never leak user-specific or pricing data on the public route.
			`"pricing"`,
			`"privacy_tier"`,
			`"is_eligible"`,
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

func TestModelsGetHidesProviderRoutingFields(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "models route never leaks provider routing details",
		Method:          http.MethodGet,
		URL:             "/api/v1/models",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"models"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			bodyBytes, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("read response: %v", err)
			}
			defer res.Body.Close()

			body := string(bodyBytes)
			for _, field := range []string{
				`"provider_model_id"`,
				`"base_url"`,
				`"baseURL"`,
				`"api_key"`,
			} {
				if strings.Contains(body, field) {
					t.Fatalf("models response leaked %s: %s", field, body)
				}
			}

			var payload struct {
				Models []map[string]any `json:"models"`
			}
			if err := json.Unmarshal(bodyBytes, &payload); err != nil {
				t.Fatalf("unmarshal models response: %v", err)
			}
			if len(payload.Models) == 0 {
				t.Fatal("expected at least one model in response")
			}
			for _, model := range payload.Models {
				for _, banned := range []string{"provider_model_id", "base_url", "api_key"} {
					if _, ok := model[banned]; ok {
						t.Errorf("model %v exposed %q field", model["id"], banned)
					}
				}
			}
		},
	}

	scenario.Test(t)
}

func TestModelsGetReturnsCuratedMetadataAndSkipsDisabledOrUnwhitelistedModels(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "models route returns curated metadata and skips disabled catalogue entries",
		Method:         http.MethodGet,
		URL:            "/api/v1/models",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"oss-eu-model"`,
			`"provider_id":"openai"`,
			`"provider_name":"OpenAI"`,
			`"hosting_country":"CH"`,
			`"hosting_region":"switzerland"`,
			`"is_open_source":true`,
			`"no_retention":true`,
			`"category":"residency"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)

			providerID := seedAIProvider(t, app, providerSeed{
				ProviderID:        "openai",
				Name:              "OpenAI",
				Enabled:           true,
				RoutingProviderID: "openai",
			})
			disabledProviderID := seedAIProvider(t, app, providerSeed{
				ProviderID:        "disabled-provider",
				Name:              "Disabled Provider",
				Enabled:           false,
				RoutingProviderID: "openai",
			})
			residencyTagID := seedAITag(t, app, tagSeed{Slug: "switzerland-extra", Title: "Switzerland", Category: "residency"})

			seedAIModel(t, app, modelSeed{
				ModelID:                   "oss-eu-model",
				ProviderRecordID:          providerID,
				ProviderModelID:           "openai/gpt-4o-mini",
				Name:                      "OSS EU Model",
				Slug:                      "oss-eu-model",
				Description:               "Allowed curated model",
				Enabled:                   true,
				Whitelisted:               true,
				PrivacyTier:               "eu",
				HostingCountry:            "CH",
				HostingRegion:             "switzerland",
				NoRetention:               true,
				IsOpenSource:              true,
				InputContextTokens:        64000,
				MaxOutputTokens:           4096,
				InputUSDPerMillionTokens:  1,
				OutputUSDPerMillionTokens: 2,
				TagRecordIDs:              []string{residencyTagID},
			})
			seedAIModel(t, app, modelSeed{
				ModelID:                   "not-whitelisted",
				ProviderRecordID:          providerID,
				ProviderModelID:           "openai/not-whitelisted",
				Name:                      "Not Whitelisted",
				Slug:                      "not-whitelisted",
				Description:               "Should not leak",
				Enabled:                   true,
				Whitelisted:               false,
				PrivacyTier:               "eu",
				InputContextTokens:        32000,
				InputUSDPerMillionTokens:  1,
				OutputUSDPerMillionTokens: 2,
			})
			seedAIModel(t, app, modelSeed{
				ModelID:                   "provider-disabled-model",
				ProviderRecordID:          disabledProviderID,
				ProviderModelID:           "openai/provider-disabled",
				Name:                      "Provider Disabled",
				Slug:                      "provider-disabled-model",
				Description:               "Should not leak",
				Enabled:                   true,
				Whitelisted:               true,
				PrivacyTier:               "eu",
				InputContextTokens:        32000,
				InputUSDPerMillionTokens:  1,
				OutputUSDPerMillionTokens: 2,
			})
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			bodyBytes, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("read response: %v", err)
			}
			body := string(bodyBytes)
			for _, banned := range []string{"not-whitelisted", "provider-disabled-model"} {
				if strings.Contains(body, banned) {
					t.Fatalf("models response leaked %q: %s", banned, body)
				}
			}
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
