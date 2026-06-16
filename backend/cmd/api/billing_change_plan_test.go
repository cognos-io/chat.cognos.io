package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

func changePlanConfig() *config.APIConfig {
	c := checkoutConfig()
	c.PaddlePricePAYGOverage = "pri_payg_overage"
	return c
}

func setupChangePlanApp(t testing.TB, client paddle.Client) *tests.TestApp {
	return setupTestAppWithHookParams(t, appHookParams{
		Config:       changePlanConfig(),
		PaddleClient: client,
	})
}

// Sunny upgrade: an active PAYG user switching to Unlimited modifies the one
// subscription (prorated immediately) and bills the final PAYG cycle's overage.
func TestBillingChangePlanUpgradesPaygToUnlimited(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{chargeTxnID: "txn_final_overage"}
	scenario := tests.ApiScenario{
		Name:            "payg → unlimited upgrades the existing subscription",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/change-plan",
		Body:            strings.NewReader(`{"plan":"unlimited_monthly"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"status":"changed"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupChangePlanApp(t, fake)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":              "payg",
				"paddle_subscription_id": "sub_1",
				"paddle_price_id":        "pri_payg",
				"paddle_cycle_start_at":  "2026-06-01 00:00:00.000Z",
				"paddle_cycle_end_at":    "2026-07-01 00:00:00.000Z",
			})
			// CHF 23.40 of PAYG usage in the open cycle → CHF 13.40 final overage.
			seedUsageRow(t, app, "uchange00000001", testUserID, "m", 2340, "2026-06-15 12:00:00.000Z")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if fake.changeCalls != 1 {
				t.Fatalf("ChangeSubscriptionPrice calls = %d, want 1", fake.changeCalls)
			}
			if fake.changeSubID != "sub_1" {
				t.Errorf("change subscription = %q, want sub_1", fake.changeSubID)
			}
			if fake.changePriceID != "pri_unl_monthly" {
				t.Errorf("change price = %q, want pri_unl_monthly", fake.changePriceID)
			}
			if fake.changeProration != "prorated_immediately" {
				t.Errorf("proration = %q, want prorated_immediately (upgrade)", fake.changeProration)
			}
			// The final PAYG cycle's overage was posted on switch.
			if fake.chargeCalls != 1 {
				t.Errorf("final overage charge calls = %d, want 1", fake.chargeCalls)
			}
			if fake.chargeQuantity != 1340 {
				t.Errorf("final overage quantity = %d, want 1340", fake.chargeQuantity)
			}
			// Local state reflects the new plan immediately.
			record, err := app.FindFirstRecordByData("user_billing", "user_id", testUserID)
			if err != nil {
				t.Fatalf("find user_billing: %v", err)
			}
			if got := record.GetString("plan_type"); got != "unlimited" {
				t.Errorf("plan_type = %q, want unlimited", got)
			}
			if got := record.GetString("paddle_price_id"); got != "pri_unl_monthly" {
				t.Errorf("paddle_price_id = %q, want pri_unl_monthly", got)
			}
		},
	}
	scenario.Test(t)
}

// Downgrade: Unlimited → PAYG uses full_next_billing_period (no mid-cycle money)
// and posts no overage (we weren't on PAYG).
func TestBillingChangePlanDowngradeUnlimitedToPayg(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{}
	scenario := tests.ApiScenario{
		Name:            "unlimited → payg defers to next billing period",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/change-plan",
		Body:            strings.NewReader(`{"plan":"payg"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"status":"changed"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupChangePlanApp(t, fake)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":              "unlimited",
				"paddle_subscription_id": "sub_1",
				"paddle_price_id":        "pri_unl_monthly",
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if fake.changeProration != "do_not_bill" {
				t.Errorf("proration = %q, want do_not_bill (downgrade, no pro-rata)", fake.changeProration)
			}
			if fake.changePriceID != "pri_payg" {
				t.Errorf("change price = %q, want pri_payg", fake.changePriceID)
			}
			if fake.chargeCalls != 0 {
				t.Errorf("overage charge calls = %d, want 0 (not switching from PAYG)", fake.chargeCalls)
			}
		},
	}
	scenario.Test(t)
}

// Lateral monthly→annual changes the billing cycle, where Paddle rejects the
// *_next_billing_period modes — it must use do_not_bill (regression: live Paddle
// returned subscription_new_items_not_valid for full_next_billing_period).
func TestBillingChangePlanMonthlyToAnnualUsesDoNotBill(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{}
	scenario := tests.ApiScenario{
		Name:            "unlimited monthly → annual uses do_not_bill",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/change-plan",
		Body:            strings.NewReader(`{"plan":"unlimited_annual"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"status":"changed"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupChangePlanApp(t, fake)
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":              "unlimited",
				"paddle_subscription_id": "sub_1",
				"paddle_price_id":        "pri_unl_monthly",
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if fake.changeProration != "do_not_bill" {
				t.Errorf("proration = %q, want do_not_bill (cycle change)", fake.changeProration)
			}
			if fake.changePriceID != "pri_unl_annual" {
				t.Errorf("change price = %q, want pri_unl_annual", fake.changePriceID)
			}
		},
	}
	scenario.Test(t)
}

// A user with no live subscription (trial) falls back to checkout.
func TestBillingChangePlanFallsBackToCheckout(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{result: paddle.CheckoutResult{
		TransactionID: "txn_new",
		CheckoutURL:   "https://pay.paddle.com/new",
		CustomerID:    "ctm_new",
	}}
	scenario := tests.ApiScenario{
		Name:            "no subscription → checkout fallback",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/change-plan",
		Body:            strings.NewReader(`{"plan":"unlimited_monthly"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"checkout_url":"https://pay.paddle.com/new"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			// testUserID starts on trial with no paddle_subscription_id.
			return setupChangePlanApp(t, fake)
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if fake.changeCalls != 0 {
				t.Errorf("ChangeSubscriptionPrice calls = %d, want 0 (no live sub)", fake.changeCalls)
			}
			if fake.calls != 1 {
				t.Errorf("CreateCheckout calls = %d, want 1 (fallback)", fake.calls)
			}
		},
	}
	scenario.Test(t)
}

func TestBillingChangePlanRequiresAuth(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:            "change-plan requires auth",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/change-plan",
		Body:            strings.NewReader(`{"plan":"payg"}`),
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{"requires valid record authorization"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupChangePlanApp(t, &fakePaddleClient{})
		},
	}
	scenario.Test(t)
}

func TestBillingChangePlanRejectsUnknownPlan(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:            "change-plan rejects an unknown plan",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/change-plan",
		Body:            strings.NewReader(`{"plan":"enterprise"}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"Unknown or unavailable plan"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupChangePlanApp(t, &fakePaddleClient{})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}
