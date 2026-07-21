package main

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// ---------------------------------------------------------------------------
// Fake Paddle client
// ---------------------------------------------------------------------------

type fakeOrgPaddleClient struct {
	mu                      sync.Mutex
	checkoutURL             string
	portalURL               string
	checkoutRequest         paddle.CheckoutRequest
	seatSubscriptionID      string
	seatPriceID             string
	seatQuantity            int
	seatMode                string
	seatError               error
	seatQuantities          []int
	seatCallStarted         chan struct{}
	seatCallRelease         chan struct{}
	cancelledSubscriptionID string
	cancelError             error
}

func (f *fakeOrgPaddleClient) CreateCheckout(_ context.Context, req paddle.CheckoutRequest) (paddle.CheckoutResult, error) {
	f.mu.Lock()
	f.checkoutRequest = req
	f.mu.Unlock()
	return paddle.CheckoutResult{
		TransactionID: "txn_fake",
		CheckoutURL:   f.checkoutURL,
		CustomerID:    "ctm_fake",
	}, nil
}

func (f *fakeOrgPaddleClient) CancelSubscription(_ context.Context, subscriptionID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cancelledSubscriptionID = subscriptionID
	return f.cancelError
}
func (f *fakeOrgPaddleClient) ResumeSubscription(_ context.Context, _ string) error { return nil }

func (f *fakeOrgPaddleClient) CreatePortalSession(_ context.Context, _ string, _ []string) (paddle.PortalSession, error) {
	return paddle.PortalSession{OverviewURL: f.portalURL}, nil
}

func (f *fakeOrgPaddleClient) GetCard(_ context.Context, _ string) (*paddle.Card, error) {
	return nil, nil
}

func (f *fakeOrgPaddleClient) ListInvoices(_ context.Context, _ string) ([]paddle.Invoice, error) {
	return nil, nil
}

func (f *fakeOrgPaddleClient) GetTransactionCustomerID(_ context.Context, _ string) (string, error) {
	return "", nil
}

func (f *fakeOrgPaddleClient) GetInvoicePDFURL(_ context.Context, _ string) (string, error) {
	return "", nil
}

func (f *fakeOrgPaddleClient) ChangeSubscriptionPrice(_ context.Context, _, _, _ string) error {
	return nil
}

func (f *fakeOrgPaddleClient) UpdateSubscriptionQuantity(
	_ context.Context,
	subscriptionID, priceID string,
	quantity int,
	prorationBillingMode string,
) error {
	f.mu.Lock()
	f.seatSubscriptionID = subscriptionID
	f.seatPriceID = priceID
	f.seatQuantity = quantity
	f.seatMode = prorationBillingMode
	f.seatQuantities = append(f.seatQuantities, quantity)
	started := f.seatCallStarted
	release := f.seatCallRelease
	err := f.seatError
	f.mu.Unlock()

	if started != nil {
		started <- struct{}{}
	}
	if release != nil {
		<-release
	}
	return err
}

func TestOrgBillingCheckoutUsesActiveMemberCount(t *testing.T) {
	client := &fakeOrgPaddleClient{checkoutURL: "https://checkout.paddle.com/fake"}

	scenario := tests.ApiScenario{
		Name:            "checkout includes every active Organisation Seat",
		Method:          http.MethodPost,
		URL:             "/api/v1/orgs/orgbill00000061/billing/checkout",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"checkout_url":"https://checkout.paddle.com/fake"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithOrgBilling(t, client)
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgbill00000061", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgbill00000061", "test2@example.com", "member", false)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			client.mu.Lock()
			defer client.mu.Unlock()
			if client.checkoutRequest.Quantity != 3 {
				t.Errorf("checkout quantity = %d, want 3 (minimum seats for 2 members)", client.checkoutRequest.Quantity)
			}
		},
	}

	scenario.Test(t)
}

func TestOrgBillingCheckoutEnforcesMinimumThreeSeats(t *testing.T) {
	client := &fakeOrgPaddleClient{checkoutURL: "https://checkout.paddle.com/fake"}

	scenario := tests.ApiScenario{
		Name:            "checkout bills the three-seat minimum for a solo owner",
		Method:          http.MethodPost,
		URL:             "/api/v1/orgs/orgbill00000062/billing/checkout",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"checkout_url":"https://checkout.paddle.com/fake"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithOrgBilling(t, client)
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgbill00000062", "Solo Org", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			client.mu.Lock()
			defer client.mu.Unlock()
			if client.checkoutRequest.Quantity != 3 {
				t.Errorf("checkout quantity = %d, want 3", client.checkoutRequest.Quantity)
			}
		},
	}

	scenario.Test(t)
}

func (f *fakeOrgPaddleClient) CreateOneTimeCharge(_ context.Context, _, _ string, _ int64, _ string) (string, error) {
	return "", nil
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

func setupTestAppWithOrgBilling(t testing.TB, client paddle.Client) *tests.TestApp {
	cfg := &config.APIConfig{
		InfomaniakAPIKey:     "test-infomaniak-key",
		InfomaniakProductID:  "test-product-id",
		RequestyAPIKey:       "test-requesty-key",
		MFATOTPEncryptionKey: testMFAKeyB64,
		PaddlePriceOrgSeat:   "pri_org_seat_test",
	}
	return setupTestAppWithHookParams(t, appHookParams{
		Config:       cfg,
		PaddleClient: client,
	})
}

func seedOrgBillingFields(t testing.TB, app *tests.TestApp, orgID string, fields map[string]any) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("org_billing")
	if err != nil {
		t.Fatalf("find org_billing: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("organisation", orgID)
	record.Set("plan_type", "payg")
	record.Set("seat_quantity", 1)
	for k, v := range fields {
		record.Set(k, v)
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("save org_billing: %v", err)
	}
}

func seedOrgUsageRow(t testing.TB, app *tests.TestApp, id, orgID, userID, modelID string, costRappen int, occurredAt string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("balance_transactions")
	if err != nil {
		t.Fatalf("find balance_transactions: %v", err)
	}
	record := core.NewRecord(collection)
	record.Id = id
	record.Set("user_id", userID)
	record.Set("organisation", orgID)
	record.Set("event_id", id)
	record.Set("type", "usage")
	record.Set("model_id", modelID)
	record.Set("amount_rappen", -costRappen)
	record.Set("user_cost_rappen", costRappen)
	record.Set("amount_microrappen", int64(-costRappen)*billing.MicroRappenPerRappen)
	record.Set("user_cost_microrappen", int64(costRappen)*billing.MicroRappenPerRappen)
	record.Set("occurred_at", occurredAt)
	if err := app.Save(record); err != nil {
		t.Fatalf("save org usage row %q: %v", id, err)
	}
}

// ---------------------------------------------------------------------------
// Role-gate table tests
// ---------------------------------------------------------------------------

func TestOrgBillingCheckoutRoleGates(t *testing.T) {
	t.Parallel()

	client := &fakeOrgPaddleClient{checkoutURL: "https://checkout.paddle.com/fake"}

	cases := []struct {
		name       string
		orgID      string
		seed       func(t testing.TB, app *tests.TestApp, e *core.ServeEvent)
		authEmail  string
		wantStatus int
		wantBody   string
	}{
		{
			name:  "owner can checkout",
			orgID: "orgbill00000001",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000001", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test1@example.com",
			wantStatus: http.StatusOK,
			wantBody:   `"checkout_url":"https://checkout.paddle.com/fake"`,
		},
		{
			name:  "admin cannot checkout",
			orgID: "orgbill00000002",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000002", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgbill00000002", "test2@example.com", "admin", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
		},
		{
			name:  "member cannot checkout",
			orgID: "orgbill00000003",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000003", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgbill00000003", "test2@example.com", "member", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
		},
		{
			name:  "non-member cannot checkout",
			orgID: "orgbill00000004",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000004", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusNotFound,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			s := tests.ApiScenario{
				Name:            c.name,
				Method:          http.MethodPost,
				URL:             "/api/v1/orgs/" + c.orgID + "/billing/checkout",
				ExpectedStatus:  c.wantStatus,
				ExpectedContent: []string{c.wantBody},
				TestAppFactory: func(t testing.TB) *tests.TestApp {
					return setupTestAppWithOrgBilling(t, client)
				},
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					c.seed(t, app, e)
					withRecordAuth("users", c.authEmail)(t, app, e)
				},
			}
			s.Test(t)
		})
	}
}

func TestOrgBillingGetRoleGates(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		orgID      string
		seed       func(t testing.TB, app *tests.TestApp, e *core.ServeEvent)
		authEmail  string
		wantStatus int
		wantBody   string
	}{
		{
			name:  "owner can get billing",
			orgID: "orgbill00000021",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000021", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test1@example.com",
			wantStatus: http.StatusOK,
			wantBody:   `"plan_type":"inactive"`,
		},
		{
			name:  "admin can get billing",
			orgID: "orgbill00000022",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000022", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgbill00000022", "test2@example.com", "admin", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusOK,
			wantBody:   `"plan_type":"inactive"`,
		},
		{
			name:  "member cannot get billing",
			orgID: "orgbill00000023",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000023", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgbill00000023", "test2@example.com", "member", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
		},
		{
			name:  "non-member cannot get billing",
			orgID: "orgbill00000024",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000024", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusNotFound,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			s := tests.ApiScenario{
				Name:            c.name,
				Method:          http.MethodGet,
				URL:             "/api/v1/orgs/" + c.orgID + "/billing",
				ExpectedStatus:  c.wantStatus,
				ExpectedContent: []string{c.wantBody},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					c.seed(t, app, e)
					withRecordAuth("users", c.authEmail)(t, app, e)
				},
			}
			s.Test(t)
		})
	}
}

func TestOrgBillingPortalRoleGates(t *testing.T) {
	t.Parallel()

	client := &fakeOrgPaddleClient{portalURL: "https://portal.paddle.com/fake"}

	cases := []struct {
		name       string
		orgID      string
		seed       func(t testing.TB, app *tests.TestApp, e *core.ServeEvent)
		authEmail  string
		wantStatus int
		wantBody   string
	}{
		{
			name:  "owner can open portal",
			orgID: "orgbill00000031",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000031", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test1@example.com",
			wantStatus: http.StatusOK,
			wantBody:   `"portal_url":"https://portal.paddle.com/fake"`,
		},
		{
			name:  "admin cannot open portal",
			orgID: "orgbill00000032",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000032", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgbill00000032", "test2@example.com", "admin", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
		},
		{
			name:  "member cannot open portal",
			orgID: "orgbill00000033",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000033", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgbill00000033", "test2@example.com", "member", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
		},
		{
			name:  "non-member cannot open portal",
			orgID: "orgbill00000034",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000034", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusNotFound,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			s := tests.ApiScenario{
				Name:            c.name,
				Method:          http.MethodGet,
				URL:             "/api/v1/orgs/" + c.orgID + "/billing/portal",
				ExpectedStatus:  c.wantStatus,
				ExpectedContent: []string{c.wantBody},
				TestAppFactory: func(t testing.TB) *tests.TestApp {
					return setupTestAppWithOrgBilling(t, client)
				},
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					c.seed(t, app, e)

					// Persist a Paddle customer so the portal handler finds one.
					org, _ := app.FindRecordById("organisations", c.orgID)
					if org != nil {
						org.Set("paddle_customer_id", "ctm_org_test")
						_ = app.Save(org)
					}

					withRecordAuth("users", c.authEmail)(t, app, e)
				},
			}
			s.Test(t)
		})
	}
}

func TestOrgUsageRoleGates(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		orgID      string
		seed       func(t testing.TB, app *tests.TestApp, e *core.ServeEvent)
		authEmail  string
		wantStatus int
		wantBody   string
	}{
		{
			name:  "owner can view usage",
			orgID: "orgbill00000041",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000041", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test1@example.com",
			wantStatus: http.StatusOK,
			wantBody:   `"total_rappen":0`,
		},
		{
			name:  "admin can view usage",
			orgID: "orgbill00000042",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000042", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgbill00000042", "test2@example.com", "admin", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusOK,
			wantBody:   `"total_rappen":0`,
		},
		{
			name:  "member cannot view usage",
			orgID: "orgbill00000043",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000043", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgbill00000043", "test2@example.com", "member", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
		},
		{
			name:  "non-member cannot view usage",
			orgID: "orgbill00000044",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgbill00000044", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusNotFound,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			s := tests.ApiScenario{
				Name:            c.name,
				Method:          http.MethodGet,
				URL:             "/api/v1/orgs/" + c.orgID + "/usage",
				ExpectedStatus:  c.wantStatus,
				ExpectedContent: []string{c.wantBody},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					c.seed(t, app, e)
					withRecordAuth("users", c.authEmail)(t, app, e)
				},
			}
			s.Test(t)
		})
	}
}

// ---------------------------------------------------------------------------
// Behaviour tests
// ---------------------------------------------------------------------------

func TestOrgBillingCheckoutReturnsCheckoutURL(t *testing.T) {
	t.Parallel()

	client := &fakeOrgPaddleClient{checkoutURL: "https://checkout.paddle.com/fake"}

	scenario := tests.ApiScenario{
		Name:           "checkout returns a Paddle checkout URL",
		Method:         http.MethodPost,
		URL:            "/api/v1/orgs/orgbill00000051/billing/checkout",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"checkout_url":"https://checkout.paddle.com/fake"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithOrgBilling(t, client)
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgbill00000051", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	scenario.Test(t)
}

func TestOrgBillingGetComputesPooledUsageAndOverage(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "billing GET returns floor, pooled usage and projected overage",
		Method:         http.MethodGet,
		URL:            "/api/v1/orgs/orgbill00000052/billing",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"plan_type":"payg"`,
			`"seat_quantity":2`,
			`"floor_rappen":3000`,
			`"pooled_usage_rappen":5200`,
			`"projected_overage_rappen":2200`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgbill00000052", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgbill00000052", "test2@example.com", "admin", false)

			cycleStart := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
			cycleEnd := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)

			seedOrgBillingFields(t, app, "orgbill00000052", map[string]any{
				"plan_type":             "payg",
				"seat_quantity":         2,
				"pending_seat_quantity": 0,
				"past_due":              false,
				"paddle_cycle_start_at": cycleStart,
				"paddle_cycle_end_at":   cycleEnd,
			})

			// 3000 + 2200 = 5200 rappen pooled.
			seedOrgUsageRow(t, app, "orgu052a0000001", "orgbill00000052", "uvi8zmr78j9y5hz", "model-a", 3000, "2026-06-05 12:00:00.000Z")
			seedOrgUsageRow(t, app, "orgu052b0000001", "orgbill00000052", "xq9ndvc2kbrvrng", "model-b", 2200, "2026-06-20 12:00:00.000Z")

			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}
	scenario.Test(t)
}

func TestOrgUsageAggregatesPerMember(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "usage aggregates per member with top models and excludes out-of-window and other-org rows",
		Method:         http.MethodGet,
		URL:            "/api/v1/orgs/orgbill00000053/usage",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"total_rappen":5200`,
			`"user":"uvi8zmr78j9y5hz"`,
			`"user":"xq9ndvc2kbrvrng"`,
			`"display_name":"Alice"`,
			`"cost_rappen":3000`,
			`"cost_rappen":2200`,
			`"completions":2`,
			`"completions":1`,
			`"top_models":["model-a","model-c"]`,
			`"top_models":["model-b"]`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgbill00000053", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgbill00000053", "test2@example.com", "admin", false)

			// Set display_name on the owner so we verify it surfaces.
			owner, _ := app.FindAuthRecordByEmail("users", "test1@example.com")
			if owner != nil {
				owner.Set("display_name", "Alice")
				_ = app.Save(owner)
			}

			cycleStart := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
			cycleEnd := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)

			seedOrgBillingFields(t, app, "orgbill00000053", map[string]any{
				"paddle_cycle_start_at": cycleStart,
				"paddle_cycle_end_at":   cycleEnd,
			})

			// Member 1 (owner): 2 completions, model-a (2000) + model-c (1000) = 3000 rappen.
			seedOrgUsageRow(t, app, "u053a0000000001", "orgbill00000053", "uvi8zmr78j9y5hz", "model-a", 2000, "2026-06-05 12:00:00.000Z")
			seedOrgUsageRow(t, app, "u053c0000000001", "orgbill00000053", "uvi8zmr78j9y5hz", "model-c", 1000, "2026-06-10 12:00:00.000Z")

			// Member 2 (admin): 1 completion, model-b = 2200 rappen.
			seedOrgUsageRow(t, app, "u053b0000000001", "orgbill00000053", "xq9ndvc2kbrvrng", "model-b", 2200, "2026-06-15 12:00:00.000Z")

			// Out-of-window row — must be excluded from totals.
			seedOrgUsageRow(t, app, "u053old00000001", "orgbill00000053", "uvi8zmr78j9y5hz", "model-a", 9999, "2026-05-15 12:00:00.000Z")

			// Other-org row — must be excluded.
			seedOrganisation(t, app, "orgother0000053", "Other AG", "test1@example.com")
			seedOrgUsageRow(t, app, "u053oth00000001", "orgother0000053", "uvi8zmr78j9y5hz", "model-a", 8888, "2026-06-15 12:00:00.000Z")

			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			body, _ := io.ReadAll(res.Body)
			s := string(body)
			if strings.Contains(s, "9999") || strings.Contains(s, "8888") {
				t.Fatalf("response leaked excluded usage rows: %s", s)
			}
		},
	}
	scenario.Test(t)
}
