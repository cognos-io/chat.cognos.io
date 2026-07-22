package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

func setupBillingApp(t testing.TB, client paddle.Client) *tests.TestApp {
	return setupTestAppWithHookParams(t, appHookParams{
		Config:       checkoutConfig(),
		PaddleClient: client,
	})
}

func updateUserBilling(t testing.TB, app *tests.TestApp, userID string, fields map[string]any) {
	t.Helper()
	record, err := app.FindFirstRecordByData("user_billing", "user_id", userID)
	if err != nil {
		t.Fatalf("find user_billing %q: %v", userID, err)
	}
	for key, value := range fields {
		record.Set(key, value)
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("save user_billing %q: %v", userID, err)
	}
}

func seedUsageRow(t testing.TB, app *tests.TestApp, id, userID, modelID string, costRappen int, occurredAt string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("balance_transactions")
	if err != nil {
		t.Fatalf("find balance_transactions: %v", err)
	}
	record := core.NewRecord(collection)
	record.Id = id
	record.Set("user_id", userID)
	record.Set("event_id", id) // unique index
	record.Set("type", "usage")
	record.Set("model_id", modelID)
	record.Set("amount_rappen", -costRappen)
	record.Set("user_cost_rappen", costRappen)
	record.Set("amount_microrappen", int64(-costRappen)*billing.MicroRappenPerRappen)
	record.Set("user_cost_microrappen", int64(costRappen)*billing.MicroRappenPerRappen)
	record.Set("occurred_at", occurredAt)
	if err := app.Save(record); err != nil {
		t.Fatalf("save usage row %q: %v", id, err)
	}
}

func TestBillingGetReportsActiveUnlimited(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "active unlimited monthly",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"plan_type":"unlimited"`,
			`"status":"active"`,
			`"interval":"monthly"`,
			`"cancel_at_period_end":false`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":           "unlimited",
				"paddle_price_id":     "pri_unl_monthly",
				"paddle_cycle_end_at": "2026-07-01 00:00:00.000Z",
				"plan_ends_at":        "",
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

// The PAYG monthly minimum is exposed on every billing response so the UI can
// show the configured floor instead of hardcoding it.
func TestBillingGetExposesPaygMinCommit(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "active payg exposes the CHF 15 minimum commit",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"plan_type":"payg"`,
			`"status":"active"`,
			`"payg_min_commit_chf":15`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":           "payg",
				"paddle_price_id":     "pri_payg",
				"paddle_cycle_end_at": "2026-07-01 00:00:00.000Z",
				"plan_ends_at":        "",
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingGetReportsPastDue(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "unlimited with a failed renewal reads past_due",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"plan_type":"unlimited"`,
			`"status":"past_due"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":           "unlimited",
				"paddle_price_id":     "pri_unl_monthly",
				"paddle_cycle_end_at": "2026-07-01 00:00:00.000Z",
				"past_due":            true,
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingGetReportsCancelsSoon(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "unlimited scheduled to cancel",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"status":"cancels_soon"`,
			`"cancel_at_period_end":true`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":       "unlimited",
				"paddle_price_id": "pri_unl_monthly",
				"plan_ends_at":    "2026-07-01 00:00:00.000Z",
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingGetReportsInactiveWithPreviousPlan(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "inactive remembers the previous plan",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"status":"inactive"`,
			`"previous_plan_type":"unlimited"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":       "inactive",
				"paddle_price_id": "pri_unl_monthly",
				"plan_ends_at":    "2026-05-14 00:00:00.000Z",
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingUsageAggregatesByModel(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:            "usage rolls up by model within the period",
		Method:          http.MethodGet,
		URL:             "/api/v1/billing/usage",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"by_model"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":             "payg",
				"paddle_cycle_start_at": "2026-06-01 00:00:00.000Z",
			})
			// In-period rows: 2× model-a, 1× model-b.
			seedUsageRow(t, app, "usagerowaaaaaa1", testUserID, "model-a", 100, "2026-06-05 00:00:00.000Z")
			seedUsageRow(t, app, "usagerowaaaaaa2", testUserID, "model-a", 40, "2026-06-07 00:00:00.000Z")
			seedUsageRow(t, app, "usagerowbbbbbb1", testUserID, "model-b", 310, "2026-06-10 00:00:00.000Z")
			// Before the period — excluded.
			seedUsageRow(t, app, "usagerowoldddd1", testUserID, "model-a", 999, "2026-05-20 00:00:00.000Z")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			body, _ := io.ReadAll(res.Body)
			defer res.Body.Close()
			var payload struct {
				MessageCount int64 `json:"message_count"`
				ByModel      []struct {
					ModelID string  `json:"model_id"`
					Count   int64   `json:"count"`
					CostCHF float64 `json:"cost_chf"`
				} `json:"by_model"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("unmarshal: %v — body: %s", err, body)
			}
			if payload.MessageCount != 3 {
				t.Errorf("message_count = %d, want 3 (old row excluded) — body: %s", payload.MessageCount, body)
			}
			if len(payload.ByModel) != 2 {
				t.Fatalf("by_model len = %d, want 2 — body: %s", len(payload.ByModel), body)
			}
			// Ordered by spend desc: model-b (3.10) before model-a (1.40).
			if payload.ByModel[0].ModelID != "model-b" || payload.ByModel[0].CostCHF != 3.10 {
				t.Errorf("first model = %+v, want model-b @ 3.10", payload.ByModel[0])
			}
			if payload.ByModel[1].ModelID != "model-a" || payload.ByModel[1].Count != 2 {
				t.Errorf("second model = %+v, want model-a count 2", payload.ByModel[1])
			}
		},
	}
	scenario.Test(t)
}

// OP-014: PAYG soft alert fires once per cycle when usage reaches the minimum
// commit. Completions are never gated on this — the field is informational.
func TestBillingUsagePaygSoftAlertSunny(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "payg over minimum surfaces soft alert",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing/usage",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"payg_soft_alert"`,
			`"show":true`,
			`"min_commit_chf":15`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":             "payg",
				"paddle_cycle_start_at": "2026-06-01 00:00:00.000Z",
			})
			// CHF 22.40 total → overage CHF 7.40.
			seedUsageRow(t, app, "softalerta00001", testUserID, "model-a", 2240, "2026-06-05 00:00:00.000Z")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			body, _ := io.ReadAll(res.Body)
			defer res.Body.Close()
			var payload struct {
				PaygSoftAlert *struct {
					Show         bool    `json:"show"`
					UsageCHF     float64 `json:"usage_chf"`
					MinCommitCHF float64 `json:"min_commit_chf"`
					OverageCHF   float64 `json:"overage_chf"`
				} `json:"payg_soft_alert"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				t.Fatalf("unmarshal: %v — body: %s", err, body)
			}
			if payload.PaygSoftAlert == nil || !payload.PaygSoftAlert.Show {
				t.Fatalf("expected soft alert show=true, body: %s", body)
			}
			if payload.PaygSoftAlert.UsageCHF != 22.4 {
				t.Errorf("usage_chf = %v, want 22.4", payload.PaygSoftAlert.UsageCHF)
			}
			if payload.PaygSoftAlert.OverageCHF != 7.4 {
				t.Errorf("overage_chf = %v, want 7.4", payload.PaygSoftAlert.OverageCHF)
			}
		},
	}
	scenario.Test(t)
}

func TestBillingUsagePaygSoftAlertUnderMinimum(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "payg under minimum keeps soft alert quiet",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing/usage",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"payg_soft_alert"`,
			`"show":false`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":             "payg",
				"paddle_cycle_start_at": "2026-06-01 00:00:00.000Z",
			})
			seedUsageRow(t, app, "softalertu00001", testUserID, "model-a", 900, "2026-06-05 00:00:00.000Z")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingUsagePaygSoftAlertOmitsForUnlimited(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:            "unlimited usage omits payg soft alert",
		Method:          http.MethodGet,
		URL:             "/api/v1/billing/usage",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"by_model"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":             "unlimited",
				"paddle_cycle_start_at": "2026-06-01 00:00:00.000Z",
			})
			seedUsageRow(t, app, "softalertx00001", testUserID, "model-a", 99_999, "2026-06-05 00:00:00.000Z")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			body, _ := io.ReadAll(res.Body)
			defer res.Body.Close()
			if strings.Contains(string(body), `"payg_soft_alert"`) {
				t.Fatalf("unlimited must omit payg_soft_alert, body: %s", body)
			}
		},
	}
	scenario.Test(t)
}

func TestBillingPaygSoftAlertAck(t *testing.T) {
	t.Parallel()

	t.Run("unauthenticated is 401", func(t *testing.T) {
		t.Parallel()
		scenario := tests.ApiScenario{
			Name:           "ack requires auth",
			Method:         http.MethodPost,
			URL:            "/api/v1/billing/payg-soft-alert/ack",
			ExpectedStatus: http.StatusUnauthorized,
			ExpectedContent: []string{
				`"status":401`,
			},
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				return setupBillingApp(t, nil)
			},
		}
		scenario.Test(t)
	})

	t.Run("ack stamps the current cycle start", func(t *testing.T) {
		t.Parallel()
		scenario := tests.ApiScenario{
			Name:           "ack stamps cycle",
			Method:         http.MethodPost,
			URL:            "/api/v1/billing/payg-soft-alert/ack",
			ExpectedStatus: http.StatusNoContent,
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				app := setupBillingApp(t, nil)
				updateUserBilling(t, app, testUserID, map[string]any{
					"plan_type":             "payg",
					"paddle_cycle_start_at": "2026-06-01 00:00:00.000Z",
				})
				return app
			},
			BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				record, err := app.FindFirstRecordByData("user_billing", "user_id", testUserID)
				if err != nil {
					t.Fatalf("find user_billing: %v", err)
				}
				got := record.GetDateTime("payg_soft_alert_cycle_start_at").Time().UTC()
				want := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
				if !got.Equal(want) {
					t.Fatalf("payg_soft_alert_cycle_start_at = %s, want %s", got, want)
				}
			},
		}
		scenario.Test(t)
	})
}

func TestBillingUsagePaygSoftAlertAlreadyAcked(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "acked this cycle stays quiet even over minimum",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing/usage",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"payg_soft_alert"`,
			`"show":false`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":                      "payg",
				"paddle_cycle_start_at":          "2026-06-01 00:00:00.000Z",
				"payg_soft_alert_cycle_start_at": "2026-06-01 00:00:00.000Z",
			})
			seedUsageRow(t, app, "softalertackd01", testUserID, "model-a", 5000, "2026-06-05 00:00:00.000Z")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingUsagePaygSoftAlertExactMinimum(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "exactly at the minimum still shows (heads-up before overage)",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing/usage",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"show":true`,
			`"overage_chf":0`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":             "payg",
				"paddle_cycle_start_at": "2026-06-01 00:00:00.000Z",
			})
			seedUsageRow(t, app, "softalertexact1", testUserID, "model-a", 1500, "2026-06-05 00:00:00.000Z")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingUsagePaygSoftAlertRearmsNextCycle(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "acked prior cycle re-arms when the new cycle is over minimum",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing/usage",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"show":true`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":                      "payg",
				"paddle_cycle_start_at":          "2026-06-01 00:00:00.000Z",
				"payg_soft_alert_cycle_start_at": "2026-05-01 00:00:00.000Z",
			})
			seedUsageRow(t, app, "softalertrearm1", testUserID, "model-a", 2000, "2026-06-05 00:00:00.000Z")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingPaygSoftAlertAckDoesNotTouchOtherUser(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "ack is self-scoped — other user's stamp stays empty",
		Method:         http.MethodPost,
		URL:            "/api/v1/billing/payg-soft-alert/ack",
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, nil)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":             "payg",
				"paddle_cycle_start_at": "2026-06-01 00:00:00.000Z",
			})
			// Other seeded user (test2) also on PAYG this cycle — must stay
			// untouched when test1 acks.
			other, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("find test2: %v", err)
			}
			updateUserBilling(t, app, other.Id, map[string]any{
				"plan_type":             "payg",
				"paddle_cycle_start_at": "2026-06-01 00:00:00.000Z",
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			other, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("find test2: %v", err)
			}
			record, err := app.FindFirstRecordByData("user_billing", "user_id", other.Id)
			if err != nil {
				t.Fatalf("find other user_billing: %v", err)
			}
			if !record.GetDateTime("payg_soft_alert_cycle_start_at").Time().IsZero() {
				t.Fatal("other user's soft-alert stamp was written — ack must be self-scoped")
			}
		},
	}
	scenario.Test(t)
}

func TestBillingCancelSchedulesCancellation(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{}
	scenario := tests.ApiScenario{
		Name:            "cancel schedules at period end",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/cancel",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"status":"cancels_soon"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, fake)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":              "unlimited",
				"paddle_subscription_id": "sub_1",
				"paddle_cycle_end_at":    "2026-07-01 00:00:00.000Z",
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if fake.canceledID != "sub_1" {
				t.Errorf("paddle CancelSubscription called with %q, want sub_1", fake.canceledID)
			}
			record, _ := app.FindFirstRecordByData("user_billing", "user_id", testUserID)
			if record.GetString("plan_ends_at") == "" {
				t.Error("plan_ends_at should be set after cancel (cancels_soon)")
			}
		},
	}
	scenario.Test(t)
}

func TestBillingCancelWithoutSubscription(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:            "cancel with no active subscription",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/cancel",
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"No active subscription"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupBillingApp(t, &fakePaddleClient{}) // default trial row, no subscription
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingCancelSurfacesPaddleError(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{subErr: context.DeadlineExceeded}
	scenario := tests.ApiScenario{
		Name:            "cancel returns 502 when paddle fails",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/cancel",
		ExpectedStatus:  http.StatusBadGateway,
		ExpectedContent: []string{"Failed to cancel subscription"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, fake)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":              "unlimited",
				"paddle_subscription_id": "sub_1",
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingResumeClearsCancellation(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{}
	scenario := tests.ApiScenario{
		Name:            "resume clears the scheduled cancellation",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/resume",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"status":"active"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, fake)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":              "unlimited",
				"paddle_subscription_id": "sub_1",
				"plan_ends_at":           "2026-07-01 00:00:00.000Z",
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if fake.resumedID != "sub_1" {
				t.Errorf("paddle ResumeSubscription called with %q, want sub_1", fake.resumedID)
			}
			record, _ := app.FindFirstRecordByData("user_billing", "user_id", testUserID)
			if record.GetString("plan_ends_at") != "" {
				t.Errorf("plan_ends_at should be cleared after resume, got %q", record.GetString("plan_ends_at"))
			}
		},
	}
	scenario.Test(t)
}
