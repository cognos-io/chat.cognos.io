package paddle

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPClientCreateCheckout_Success(t *testing.T) {
	var gotAuth, gotPath string
	var gotBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"id":"txn_1","customer_id":"ctm_9","checkout":{"url":"https://pay.paddle.com/abc"}}}`))
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, "pdl_test_key")
	res, err := client.CreateCheckout(context.Background(), CheckoutRequest{
		PriceID:   "pri_unlimited",
		UserID:    "user_123",
		ReturnURL: "https://app.cognos.io/account/billing?status=activating",
		Business:  &Business{Name: "Acme AG", TaxID: "CHE-1", CountryCode: "CH"},
	})
	if err != nil {
		t.Fatalf("CreateCheckout: %v", err)
	}

	if res.CheckoutURL != "https://pay.paddle.com/abc" {
		t.Errorf("CheckoutURL = %q", res.CheckoutURL)
	}
	if res.TransactionID != "txn_1" || res.CustomerID != "ctm_9" {
		t.Errorf("unexpected ids: %+v", res)
	}
	if gotAuth != "Bearer pdl_test_key" {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if gotPath != "/transactions" {
		t.Errorf("path = %q", gotPath)
	}

	// custom_data.user_id must be forwarded for webhook mapping, and the
	// business details mirrored onto the transaction.
	customData, _ := gotBody["custom_data"].(map[string]any)
	if customData["user_id"] != "user_123" {
		t.Errorf("custom_data.user_id = %v", customData["user_id"])
	}
	if customData["business_name"] != "Acme AG" {
		t.Errorf("custom_data.business_name = %v", customData["business_name"])
	}
}

func TestHTTPClientChangeSubscriptionPrice(t *testing.T) {
	var gotMethod, gotPath string
	var gotBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"id":"sub_1"}}`))
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, "k")
	if err := client.ChangeSubscriptionPrice(
		context.Background(), "sub_1", "pri_new", "prorated_immediately",
	); err != nil {
		t.Fatalf("ChangeSubscriptionPrice: %v", err)
	}
	if gotMethod != http.MethodPatch {
		t.Errorf("method = %q, want PATCH", gotMethod)
	}
	if gotPath != "/subscriptions/sub_1" {
		t.Errorf("path = %q, want /subscriptions/sub_1", gotPath)
	}
	if gotBody["proration_billing_mode"] != "prorated_immediately" {
		t.Errorf("proration_billing_mode = %v", gotBody["proration_billing_mode"])
	}
	items, _ := gotBody["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if item, _ := items[0].(map[string]any); item["price_id"] != "pri_new" {
		t.Errorf("item price_id = %v, want pri_new", item["price_id"])
	}
}

func TestHTTPClientCreateOneTimeCharge_Success(t *testing.T) {
	var gotPath, gotIdem, gotMethod string
	var gotBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotIdem = r.Header.Get("Paddle-Idempotency-Key")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"data":{"id":"sub_1","next_transaction":{"id":"txn_next_9"}}}`))
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, "pdl_test_key")
	txnID, err := client.CreateOneTimeCharge(
		context.Background(), "sub_1", "pri_overage", 1340, "overage_cycleabc",
	)
	if err != nil {
		t.Fatalf("CreateOneTimeCharge: %v", err)
	}
	if txnID != "txn_next_9" {
		t.Errorf("txnID = %q, want txn_next_9", txnID)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/subscriptions/sub_1/charge" {
		t.Errorf("path = %q, want /subscriptions/sub_1/charge", gotPath)
	}
	if gotIdem != "overage_cycleabc" {
		t.Errorf("Paddle-Idempotency-Key = %q", gotIdem)
	}
	if gotBody["effective_from"] != "next_billing_period" {
		t.Errorf("effective_from = %v, want next_billing_period", gotBody["effective_from"])
	}
	items, _ := gotBody["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	item, _ := items[0].(map[string]any)
	if item["price_id"] != "pri_overage" {
		t.Errorf("item price_id = %v, want pri_overage", item["price_id"])
	}
	// JSON numbers decode to float64.
	if qty, _ := item["quantity"].(float64); qty != 1340 {
		t.Errorf("item quantity = %v, want 1340", item["quantity"])
	}
}

func TestHTTPClientCreateOneTimeCharge_RejectsZeroQuantity(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, "k")
	if _, err := client.CreateOneTimeCharge(context.Background(), "sub_1", "pri_overage", 0, "k1"); err == nil {
		t.Error("expected an error for quantity < 1")
	}
	if called {
		t.Error("must not call Paddle with an invalid quantity")
	}
}

func TestHTTPClientCreateOneTimeCharge_PaddleError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"code":"subscription_not_active"}}`))
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, "k")
	if _, err := client.CreateOneTimeCharge(context.Background(), "sub_1", "pri_overage", 100, "k1"); err == nil {
		t.Error("expected an error on a non-2xx Paddle response")
	}
}

func TestHTTPClientCreateCheckout_PaddleError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"code":"price_not_found"}}`))
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, "k")
	_, err := client.CreateCheckout(context.Background(), CheckoutRequest{PriceID: "pri_x", UserID: "u"})
	if err == nil {
		t.Fatal("expected error on non-2xx")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("error should mention status: %v", err)
	}
}

func TestHTTPClientCreateCheckout_MissingURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"id":"txn_1"}}`))
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, "k")
	_, err := client.CreateCheckout(context.Background(), CheckoutRequest{PriceID: "pri_x", UserID: "u"})
	if err == nil {
		t.Fatal("expected error when checkout url is absent")
	}
}

func TestHTTPClientCreatePortalSession_Success(t *testing.T) {
	var gotPath string
	var gotBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"urls":{"general":{"overview":"https://portal/over?token=t"},` +
			`"subscriptions":[{"id":"sub_1","update_subscription_payment_method":"https://portal/pay?token=t"}]}}}`))
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, "k")
	session, err := client.CreatePortalSession(context.Background(), "ctm_9", []string{"sub_1"})
	if err != nil {
		t.Fatalf("CreatePortalSession: %v", err)
	}

	if gotPath != "/customers/ctm_9/portal-sessions" {
		t.Errorf("path = %q", gotPath)
	}
	subs, _ := gotBody["subscription_ids"].([]any)
	if len(subs) != 1 || subs[0] != "sub_1" {
		t.Errorf("subscription_ids = %v", gotBody["subscription_ids"])
	}
	if session.OverviewURL != "https://portal/over?token=t" {
		t.Errorf("OverviewURL = %q", session.OverviewURL)
	}
	if session.UpdatePaymentURL != "https://portal/pay?token=t" {
		t.Errorf("UpdatePaymentURL = %q", session.UpdatePaymentURL)
	}
}

func TestHTTPClientCreatePortalSession_MissingOverview(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"urls":{"general":{}}}}`))
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, "k")
	_, err := client.CreatePortalSession(context.Background(), "ctm_9", nil)
	if err == nil {
		t.Fatal("expected error when overview url is absent")
	}
}

func TestHTTPClientGetCard_Success(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_, _ = w.Write([]byte(`{"data":[{"type":"card","card":{"type":"visa","last4":"4242","expiry_month":9,"expiry_year":2028}}]}`))
	}))
	defer server.Close()

	card, err := NewHTTPClient(server.URL, "k").GetCard(context.Background(), "ctm_9")
	if err != nil {
		t.Fatalf("GetCard: %v", err)
	}
	if gotPath != "/customers/ctm_9/payment-methods" {
		t.Errorf("path = %q", gotPath)
	}
	if card == nil || card.Brand != "visa" || card.Last4 != "4242" ||
		card.ExpiryMonth != 9 || card.ExpiryYear != 2028 {
		t.Errorf("unexpected card: %+v", card)
	}
}

func TestHTTPClientGetCard_None(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()

	card, err := NewHTTPClient(server.URL, "k").GetCard(context.Background(), "ctm_9")
	if err != nil {
		t.Fatalf("GetCard: %v", err)
	}
	if card != nil {
		t.Errorf("expected no card, got %+v", card)
	}
}

func TestHTTPClientGetCard_FallsBackToTransactions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Payment-methods returns nothing; the card is recovered from the
		// transaction's payment details.
		if strings.Contains(r.URL.Path, "payment-methods") {
			_, _ = w.Write([]byte(`{"data":[]}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"txn_1","status":"completed",` +
			`"payments":[{"method_details":{"type":"card","card":{"type":"mastercard",` +
			`"last4":"5556","expiry_month":3,"expiry_year":2030}}}]}]}`))
	}))
	defer server.Close()

	card, err := NewHTTPClient(server.URL, "k").GetCard(context.Background(), "ctm_9")
	if err != nil {
		t.Fatalf("GetCard: %v", err)
	}
	if card == nil || card.Brand != "mastercard" || card.Last4 != "5556" ||
		card.ExpiryMonth != 3 || card.ExpiryYear != 2030 {
		t.Errorf("unexpected card from transactions: %+v", card)
	}
}

func TestHTTPClientListInvoices_Success(t *testing.T) {
	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		_, _ = w.Write([]byte(`{"data":[{"id":"txn_1","invoice_number":"CG-26-0002","status":"paid",` +
			`"currency_code":"CHF","billed_at":"2026-04-14T00:00:00Z",` +
			`"details":{"totals":{"grand_total":"10000"}}}]}`))
	}))
	defer server.Close()

	invoices, err := NewHTTPClient(server.URL, "k").ListInvoices(context.Background(), "ctm_9")
	if err != nil {
		t.Fatalf("ListInvoices: %v", err)
	}
	if !strings.Contains(gotQuery, "customer_id=ctm_9") {
		t.Errorf("query = %q", gotQuery)
	}
	if len(invoices) != 1 {
		t.Fatalf("got %d invoices", len(invoices))
	}
	inv := invoices[0]
	if inv.ID != "txn_1" || inv.InvoiceNumber != "CG-26-0002" || inv.Status != "paid" ||
		inv.CurrencyCode != "CHF" || inv.GrandTotalMinor != 10000 {
		t.Errorf("unexpected invoice: %+v", inv)
	}
	if inv.BilledAt.IsZero() {
		t.Error("billed_at should be parsed")
	}
}

func TestHTTPClientListInvoices_PaddleError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"code":"forbidden"}}`))
	}))
	defer server.Close()

	_, err := NewHTTPClient(server.URL, "k").ListInvoices(context.Background(), "ctm_9")
	if err == nil {
		t.Fatal("expected error on non-2xx")
	}
}

func TestNewHTTPClientDefaultsBaseURL(t *testing.T) {
	if got := NewHTTPClient("", "k").BaseURL; got != "https://api.paddle.com" {
		t.Errorf("default BaseURL = %q", got)
	}
	if got := NewHTTPClient("https://sandbox-api.paddle.com/", "k").BaseURL; got != "https://sandbox-api.paddle.com" {
		t.Errorf("trimmed BaseURL = %q", got)
	}
}
