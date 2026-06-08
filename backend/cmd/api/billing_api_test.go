package main

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
)

func TestBillingGetRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "billing route requires record auth",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing",
		ExpectedStatus: http.StatusUnauthorized,
		ExpectedContent: []string{
			`"message":"The request requires valid record authorization token."`,
		},
		TestAppFactory: setupTestApp,
	}

	scenario.Test(t)
}

func TestBillingGetReturnsTrialBalance(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "billing route returns trial plan with seeded balance",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"plan_type":"trial"`,
			`"balance_chf":2.5`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupTestApp(t)
			setUserBillingRecord(t, app, seedUserBillingRecordInput{
				UserID:        "uvi8zmr78j9y5hz",
				PlanType:      string(billing.PlanTypeTrial),
				BalanceRappen: 250,
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestBillingGetReturnsUnlimitedPlan(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "billing route returns unlimited plan with zero balance",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"plan_type":"unlimited"`,
			`"balance_chf":0`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupTestApp(t)
			setUserBillingRecord(t, app, seedUserBillingRecordInput{
				UserID:        "uvi8zmr78j9y5hz",
				PlanType:      string(billing.PlanTypeUnlimited),
				BalanceRappen: 0,
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestBillingGetTreatsMissingStateAsInactive(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "billing route reports inactive when no billing row exists",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"plan_type":"inactive"`,
			`"balance_chf":0`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupTestApp(t)
			// Remove the trial bootstrap that fires automatically for new users
			// so the handler sees ErrStateNotFound.
			records, err := app.FindRecordsByFilter(
				"user_billing",
				"user_id = {:user_id}",
				"",
				10,
				0,
				map[string]any{"user_id": "uvi8zmr78j9y5hz"},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(user_billing) error = %v", err)
			}
			for _, record := range records {
				if err := app.Delete(record); err != nil {
					t.Fatalf("Delete(user_billing) error = %v", err)
				}
			}
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}
