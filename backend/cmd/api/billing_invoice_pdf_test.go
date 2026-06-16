package main

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// Sunny: a user can fetch the PDF URL for their own invoice.
func TestBillingInvoicePDFForOwnInvoice(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{txnCustomerID: "ctm_1", invoicePDFURL: "https://paddle.com/inv/abc.pdf"}
	scenario := tests.ApiScenario{
		Name:            "pdf url for own invoice",
		Method:          http.MethodGet,
		URL:             "/api/v1/billing/invoices/txn_1/pdf",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"url":"https://paddle.com/inv/abc.pdf"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, fake)
			setUserField(t, app, "test1@example.com", "paddle_customer_id", "ctm_1")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			// Ownership is checked before the invoice is fetched.
			if fake.txnLookupID != "txn_1" {
				t.Errorf("ownership check txn = %q, want txn_1", fake.txnLookupID)
			}
			if fake.pdfLookupID != "txn_1" {
				t.Errorf("pdf fetch txn = %q, want txn_1", fake.pdfLookupID)
			}
		},
	}
	scenario.Test(t)
}

// Security: a transaction owned by a different customer is 404, and the invoice
// endpoint is never called for it.
func TestBillingInvoicePDFRejectsOtherCustomer(t *testing.T) {
	t.Parallel()
	fake := &fakePaddleClient{txnCustomerID: "ctm_someone_else", invoicePDFURL: "https://paddle.com/secret.pdf"}
	scenario := tests.ApiScenario{
		Name:           "pdf for another customer's invoice is 404",
		Method:         http.MethodGet,
		URL:             "/api/v1/billing/invoices/txn_x/pdf",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{"Invoice not found"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := setupBillingApp(t, fake)
			setUserField(t, app, "test1@example.com", "paddle_customer_id", "ctm_1")
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if fake.pdfLookupID != "" {
				t.Errorf("invoice PDF must not be fetched for a non-owned txn (got %q)", fake.pdfLookupID)
			}
		},
	}
	scenario.Test(t)
}

func TestBillingInvoicePDFRequiresAuth(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:            "pdf requires auth",
		Method:          http.MethodGet,
		URL:             "/api/v1/billing/invoices/txn_1/pdf",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{"requires valid record authorization"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupBillingApp(t, &fakePaddleClient{})
		},
	}
	scenario.Test(t)
}
