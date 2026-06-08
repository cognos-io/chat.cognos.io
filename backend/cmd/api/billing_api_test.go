package main

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
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

func TestBillingTransactionsRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "billing transactions route requires record auth",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing/transactions",
		ExpectedStatus: http.StatusUnauthorized,
		ExpectedContent: []string{
			`"message":"The request requires valid record authorization token."`,
		},
		TestAppFactory: setupTestApp,
	}

	scenario.Test(t)
}

func TestBillingTransactionsReturnsRecentRowsNewestFirst(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "billing transactions route returns user ledger newest-first",
		Method:          http.MethodGet,
		URL:             "/api/v1/billing/transactions",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"transactions"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupTestApp(t)

			collection, err := app.FindCollectionByNameOrId("balance_transactions")
			if err != nil {
				t.Fatalf("FindCollectionByNameOrId(balance_transactions) error = %v", err)
			}

			rows := []struct {
				id           string
				occurredAt   string
				txnType      string
				amount       int
				planType     string
				balanceAfter int
				eventID      string
				modelID      string
				description  string
			}{
				{
					id:           "txnoldzzzzzz001",
					occurredAt:   "2026-06-01 09:00:00.000Z",
					txnType:      billing.UsageTransactionType,
					amount:       -8,
					planType:     string(billing.PlanTypeTrial),
					balanceAfter: 192,
					eventID:      "evt-old",
					modelID:      "llama-3-3-infomaniak",
					description:  "llama-3-3-infomaniak",
				},
				{
					id:           "txnnewzzzzzz002",
					occurredAt:   "2026-06-05 10:30:00.000Z",
					txnType:      billing.UsageTransactionType,
					amount:       -12,
					planType:     string(billing.PlanTypeTrial),
					balanceAfter: 180,
					eventID:      "evt-new",
					modelID:      "llama-3-3-infomaniak",
					description:  "llama-3-3-infomaniak",
				},
			}
			for _, row := range rows {
				record := core.NewRecord(collection)
				record.Id = row.id
				record.Set("user_id", "uvi8zmr78j9y5hz")
				record.Set("occurred_at", row.occurredAt)
				record.Set("type", row.txnType)
				record.Set("amount_rappen", row.amount)
				record.Set("plan_type", row.planType)
				record.Set("balance_after_rappen", row.balanceAfter)
				record.Set("event_id", row.eventID)
				record.Set("model_id", row.modelID)
				record.Set("description", row.description)
				if err := app.Save(record); err != nil {
					t.Fatalf("Save(balance_transactions %q) error = %v", row.id, err)
				}
			}
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("read response: %v", err)
			}
			defer res.Body.Close()

			var payload struct {
				Transactions []struct {
					ID              string   `json:"id"`
					Type            string   `json:"type"`
					AmountCHF       float64  `json:"amount_chf"`
					BalanceAfterCHF *float64 `json:"balance_after_chf"`
					EventID         string   `json:"event_id"`
					ModelID         string   `json:"model_id"`
				} `json:"transactions"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("unmarshal response: %v", err)
			}
			if len(payload.Transactions) != 2 {
				t.Fatalf("transactions len = %d, want 2 — body: %s", len(payload.Transactions), body)
			}
			if payload.Transactions[0].ID != "txnnewzzzzzz002" {
				t.Errorf("transactions[0].id = %q, want newest first (txnnewzzzzzz002)", payload.Transactions[0].ID)
			}
			if payload.Transactions[0].AmountCHF != -0.12 {
				t.Errorf("transactions[0].amount_chf = %v, want -0.12", payload.Transactions[0].AmountCHF)
			}
			if payload.Transactions[0].BalanceAfterCHF == nil || *payload.Transactions[0].BalanceAfterCHF != 1.8 {
				t.Errorf("transactions[0].balance_after_chf = %v, want 1.8", payload.Transactions[0].BalanceAfterCHF)
			}
			if payload.Transactions[1].ID != "txnoldzzzzzz001" {
				t.Errorf("transactions[1].id = %q, want oldest second", payload.Transactions[1].ID)
			}
		},
	}

	scenario.Test(t)
}

func TestBillingTransactionsHidesOtherUsersRows(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "billing transactions route only surfaces the authenticated user's rows",
		Method:          http.MethodGet,
		URL:             "/api/v1/billing/transactions",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"transactions"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupTestApp(t)
			seedBalanceTransactionRecord(t, app, seedBalanceTransactionRecordInput{
				ID:           "txnotherzzzz001",
				UserID:       "xq9ndvc2kbrvrng",
				EventID:      "evt-other",
				Type:         billing.UsageTransactionType,
				AmountRappen: -25,
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("read response: %v", err)
			}
			defer res.Body.Close()
			var payload struct {
				Transactions []map[string]any `json:"transactions"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if len(payload.Transactions) != 0 {
				t.Errorf("expected 0 transactions for unrelated user, got %d — body: %s", len(payload.Transactions), body)
			}
		},
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
