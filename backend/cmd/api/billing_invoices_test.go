package main

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

// Sunny: a user with a Paddle customer gets their card + invoices.
func TestBillingInvoicesReturnsCardAndInvoices(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{
		card: &paddle.Card{Brand: "visa", Last4: "4242", ExpiryMonth: 9, ExpiryYear: 2028},
		invoices: []paddle.Invoice{
			{
				ID:              "txn_1",
				InvoiceNumber:   "CG-26-0002",
				Status:          "paid",
				CurrencyCode:    "CHF",
				GrandTotalMinor: 10000,
				Description:     "Unlimited · monthly",
				BilledAt:        time.Date(2026, 4, 14, 0, 0, 0, 0, time.UTC),
			},
		},
	}
	scenario := tests.ApiScenario{
		Name:           "card + invoices for a paddle customer",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing/invoices",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"brand":"visa"`,
			`"last4":"4242"`,
			`"invoice_number":"CG-26-0002"`,
			`"description":"Unlimited · monthly"`,
			`"status":"paid"`,
			`"amount_minor":10000`,
			`"currency":"CHF"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, fake)
			setUserField(t, app, "test1@example.com", "paddle_customer_id", "ctm_1")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

// A transaction with a recorded refund surfaces as REFUNDED (Paddle has no such
// status — we derive it from the local refunds ledger).
func TestBillingInvoicesDerivesRefundedStatus(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{
		invoices: []paddle.Invoice{
			{ID: "txn_refunded", InvoiceNumber: "CG-26-0009", Status: "completed", CurrencyCode: "CHF", GrandTotalMinor: 10000},
			{ID: "txn_paid", InvoiceNumber: "CG-26-0010", Status: "completed", CurrencyCode: "CHF", GrandTotalMinor: 10000},
		},
	}
	scenario := tests.ApiScenario{
		Name:           "refunded transaction shows refunded status",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing/invoices",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"txn_refunded","invoice_number":"CG-26-0009","status":"refunded"`,
			`"id":"txn_paid","invoice_number":"CG-26-0010","status":"completed"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, fake)
			setUserField(t, app, "test1@example.com", "paddle_customer_id", "ctm_1")
			seedRefund(t, app, "refund000000001", `{"adjustment_ids":["adj_1"],"transaction_id":"txn_refunded"}`)
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

// Rainy/edge: no Paddle customer (e.g. trial) → empty payload, never an error.
func TestBillingInvoicesEmptyWithoutCustomer(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "no customer yields empty invoices",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing/invoices",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"card":null`,
			`"invoices":[]`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupBillingApp(t, &fakePaddleClient{})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}

// Rainy: a Paddle failure degrades gracefully — the page still renders (200)
// with the failing section omitted rather than erroring.
func TestBillingInvoicesDegradesOnPaddleError(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{
		cardErr:     context.DeadlineExceeded,
		invoicesErr: context.DeadlineExceeded,
	}
	scenario := tests.ApiScenario{
		Name:           "paddle errors degrade to an empty payload",
		Method:         http.MethodGet,
		URL:            "/api/v1/billing/invoices",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"card":null`,
			`"invoices":[]`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, fake)
			setUserField(t, app, "test1@example.com", "paddle_customer_id", "ctm_1")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	scenario.Test(t)
}
