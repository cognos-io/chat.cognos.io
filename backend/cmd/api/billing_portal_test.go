package main

import (
	"context"
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

// setUserField sets and saves a single field on the test user record.
func setUserField(t testing.TB, app *tests.TestApp, email, key string, value any) {
	t.Helper()
	record, err := app.FindFirstRecordByData("users", "email", email)
	if err != nil {
		t.Fatalf("find user %q: %v", email, err)
	}
	record.Set(key, value)
	if err := app.Save(record); err != nil {
		t.Fatalf("save user %q: %v", email, err)
	}
}

// Sunny: a user with a Paddle customer + subscription gets both portal links,
// and the subscription id is forwarded so the payment-method deep link resolves.
func TestBillingPortalReturnsLinks(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{
		portal: paddle.PortalSession{
			OverviewURL:      "https://customer-portal.paddle.com/overview?token=abc",
			UpdatePaymentURL: "https://customer-portal.paddle.com/update?token=abc",
		},
	}
	scenario := tests.ApiScenario{
		Name:           "portal returns authenticated links",
		Method:         http.MethodPost,
		URL:            "/api/v1/billing/portal",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"overview_url":"https://customer-portal.paddle.com/overview?token=abc"`,
			`"update_payment_url":"https://customer-portal.paddle.com/update?token=abc"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, fake)
			setUserField(t, app, "test1@example.com", "paddle_customer_id", "ctm_1")
			updateUserBilling(t, app, testUserID, map[string]any{
				"plan_type":              "unlimited",
				"paddle_subscription_id": "sub_1",
			})
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if fake.portalCust != "ctm_1" {
				t.Errorf("portal called with customer %q, want ctm_1", fake.portalCust)
			}
			if len(fake.portalSubs) != 1 || fake.portalSubs[0] != "sub_1" {
				t.Errorf("portal called with subs %v, want [sub_1]", fake.portalSubs)
			}
		},
	}
	scenario.Test(t)
}

// Rainy: a user who never checked out has no Paddle customer, so there is
// nothing to manage - 409.
func TestBillingPortalWithoutCustomer(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:            "portal needs a paddle customer",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/portal",
		ExpectedStatus:  http.StatusConflict,
		ExpectedContent: []string{"No billing account yet"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupBillingApp(t, &fakePaddleClient{})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

// Rainy: when Paddle fails, the handler surfaces a 502 (never a 500/leak).
func TestBillingPortalSurfacesPaddleError(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{portalErr: context.DeadlineExceeded}
	scenario := tests.ApiScenario{
		Name:            "portal returns 502 when paddle fails",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/portal",
		ExpectedStatus:  http.StatusBadGateway,
		ExpectedContent: []string{"Failed to open billing portal"},
		// Cause goes to the log's data.details, never to the caller.
		NotExpectedContent: []string{"context deadline exceeded"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, fake)
			setUserField(t, app, "test1@example.com", "paddle_customer_id", "ctm_1")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}
