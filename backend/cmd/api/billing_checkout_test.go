package main

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

// fakePaddleClient records the last checkout request and returns canned values.
type fakePaddleClient struct {
	result      paddle.CheckoutResult
	err         error
	gotReq      paddle.CheckoutRequest
	calls       int
	subErr      error
	canceledID  string
	resumedID   string
	portal      paddle.PortalSession
	portalErr   error
	portalCust  string
	portalSubs  []string
	portalCalls int
}

func (f *fakePaddleClient) CreateCheckout(
	_ context.Context,
	req paddle.CheckoutRequest,
) (paddle.CheckoutResult, error) {
	f.calls++
	f.gotReq = req
	return f.result, f.err
}

func (f *fakePaddleClient) CancelSubscription(_ context.Context, id string) error {
	f.canceledID = id
	return f.subErr
}

func (f *fakePaddleClient) ResumeSubscription(_ context.Context, id string) error {
	f.resumedID = id
	return f.subErr
}

func (f *fakePaddleClient) CreatePortalSession(
	_ context.Context,
	customerID string,
	subscriptionIDs []string,
) (paddle.PortalSession, error) {
	f.portalCalls++
	f.portalCust = customerID
	f.portalSubs = subscriptionIDs
	return f.portal, f.portalErr
}

func checkoutConfig() *config.APIConfig {
	return &config.APIConfig{
		InfomaniakAPIKey:            "test-infomaniak-key",
		InfomaniakProductID:         "test-product-id",
		PaddleAPIBase:               "https://api.paddle.com",
		PaddlePricePAYG:             "pri_payg",
		PaddlePriceUnlimitedMonthly: "pri_unl_monthly",
		PaddlePriceUnlimitedAnnual:  "pri_unl_annual",
		BillingTrialSeedRappen:      200,
	}
}

func setupCheckoutApp(t testing.TB, client paddle.Client) *tests.TestApp {
	return setupTestAppWithHookParams(t, appHookParams{
		PaddleClient: client,
		Config:       checkoutConfig(),
	})
}

func TestBillingCheckoutRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "checkout requires record auth",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/checkout",
		Body:            strings.NewReader(`{"plan":"payg"}`),
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{"requires valid record authorization"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupCheckoutApp(t, &fakePaddleClient{})
		},
	}
	scenario.Test(t)
}

func TestBillingCheckoutSucceeds(t *testing.T) {
	t.Parallel()

	fake := &fakePaddleClient{
		result: paddle.CheckoutResult{
			TransactionID: "txn_1",
			CheckoutURL:   "https://pay.paddle.com/abc",
			CustomerID:    "ctm_42",
		},
	}

	scenario := tests.ApiScenario{
		Name:            "checkout returns the paddle url for a known plan",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/checkout",
		Body:            strings.NewReader(`{"plan":"unlimited_monthly","return_url":"https://app/x"}`),
		Headers:         map[string]string{"Content-Type": "application/json"},
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"checkout_url":"https://pay.paddle.com/abc"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupCheckoutApp(t, fake)
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if fake.gotReq.PriceID != "pri_unl_monthly" {
				t.Errorf("price id = %q, want pri_unl_monthly", fake.gotReq.PriceID)
			}
			if fake.gotReq.UserID != "uvi8zmr78j9y5hz" {
				t.Errorf("user id = %q, want the authed user", fake.gotReq.UserID)
			}
			// The returned Paddle customer id is persisted for reuse.
			user, err := app.FindRecordById("users", "uvi8zmr78j9y5hz")
			if err != nil {
				t.Fatalf("find user: %v", err)
			}
			if got := user.GetString("paddle_customer_id"); got != "ctm_42" {
				t.Errorf("paddle_customer_id = %q, want ctm_42", got)
			}
		},
	}
	scenario.Test(t)
}

func TestBillingCheckoutForwardsBusinessDetails(t *testing.T) {
	t.Parallel()

	fake := &fakePaddleClient{result: paddle.CheckoutResult{CheckoutURL: "https://pay/x"}}

	scenario := tests.ApiScenario{
		Name:   "checkout mirrors business details onto the user and forwards them",
		Method: http.MethodPost,
		URL:    "/api/v1/billing/checkout",
		Body: strings.NewReader(
			`{"plan":"payg","business":{"name":"Acme AG","vat_id":"CHE-1","country":"CH"}}`,
		),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"checkout_url"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupCheckoutApp(t, fake)
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if fake.gotReq.Business == nil || fake.gotReq.Business.Name != "Acme AG" {
				t.Errorf("business not forwarded to paddle: %+v", fake.gotReq.Business)
			}
			user, err := app.FindRecordById("users", "uvi8zmr78j9y5hz")
			if err != nil {
				t.Fatalf("find user: %v", err)
			}
			if user.GetString("business_name") != "Acme AG" ||
				user.GetString("business_vat_id") != "CHE-1" ||
				user.GetString("business_country") != "CH" {
				t.Errorf("business not mirrored onto user record")
			}
		},
	}
	scenario.Test(t)
}

func TestBillingCheckoutRejectsUnknownPlan(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "checkout rejects an unknown plan",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/checkout",
		Body:            strings.NewReader(`{"plan":"enterprise"}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"Unknown or unavailable plan"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupCheckoutApp(t, &fakePaddleClient{})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingCheckoutSurfacesPaddleFailure(t *testing.T) {
	t.Parallel()

	fake := &fakePaddleClient{err: context.DeadlineExceeded}

	scenario := tests.ApiScenario{
		Name:            "checkout returns 502 when paddle fails",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/checkout",
		Body:            strings.NewReader(`{"plan":"payg"}`),
		ExpectedStatus:  http.StatusBadGateway,
		ExpectedContent: []string{"Failed to start checkout"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupCheckoutApp(t, fake)
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

func TestBillingCheckoutUnavailableWithoutPaddle(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "checkout returns 503 when paddle is not configured",
		Method:          http.MethodPost,
		URL:             "/api/v1/billing/checkout",
		Body:            strings.NewReader(`{"plan":"payg"}`),
		ExpectedStatus:  http.StatusServiceUnavailable,
		ExpectedContent: []string{"Billing is not configured"},
		// Default test app has no Paddle client configured.
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}
