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

func TestNewHTTPClientDefaultsBaseURL(t *testing.T) {
	if got := NewHTTPClient("", "k").BaseURL; got != "https://api.paddle.com" {
		t.Errorf("default BaseURL = %q", got)
	}
	if got := NewHTTPClient("https://sandbox-api.paddle.com/", "k").BaseURL; got != "https://sandbox-api.paddle.com" {
		t.Errorf("trimmed BaseURL = %q", got)
	}
}
