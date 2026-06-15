// Package paddle is a thin client for the Paddle Billing API. It deliberately
// exposes only what Cognos needs (checkout creation today; more later) behind a
// small interface so handlers can be tested with a fake.
package paddle

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Business carries the optional company-invoicing details forwarded to Paddle
// so the resulting invoice is correctly addressed.
type Business struct {
	Name        string
	TaxID       string // VAT / UID registration
	CountryCode string // ISO 3166-1 alpha-2
}

// CheckoutRequest is everything needed to open a hosted Paddle checkout for a
// single plan price.
type CheckoutRequest struct {
	PriceID    string
	UserID     string // Cognos user id → custom_data.user_id (webhook ↔ user map)
	CustomerID string // existing Paddle customer id, if known
	Business   *Business
	ReturnURL  string // where Paddle returns the buyer after payment
}

// CheckoutResult is the subset of the Paddle transaction we act on.
type CheckoutResult struct {
	TransactionID string
	CheckoutURL   string
	CustomerID    string
}

// PortalSession holds the authenticated customer-portal links Paddle mints for
// a customer. The links carry a short-lived token and must not be cached.
type PortalSession struct {
	OverviewURL      string // customer portal homepage
	UpdatePaymentURL string // deep link to the update-payment-method form (if any)
}

// Card is the saved payment-method summary shown on the dashboard. Only
// non-sensitive display fields — never a full card number (Paddle holds that).
type Card struct {
	Brand       string // "visa", "mastercard", …
	Last4       string
	ExpiryMonth int
	ExpiryYear  int
}

// Invoice is the slice of a Paddle transaction we surface as an invoice row.
type Invoice struct {
	ID              string
	InvoiceNumber   string
	Status          string // paid, completed, billed, past_due, canceled
	CurrencyCode    string
	BilledAt        time.Time
	GrandTotalMinor int64 // total in the currency's minor unit (Rappen for CHF)
}

// Client is the Paddle surface the billing handlers depend on.
type Client interface {
	CreateCheckout(ctx context.Context, req CheckoutRequest) (CheckoutResult, error)
	// CancelSubscription schedules cancellation at the end of the current
	// billing period (access continues until then).
	CancelSubscription(ctx context.Context, subscriptionID string) error
	// ResumeSubscription removes a scheduled cancellation.
	ResumeSubscription(ctx context.Context, subscriptionID string) error
	// CreatePortalSession mints authenticated customer-portal links. When a
	// subscription id is supplied, the result includes its payment-method deep
	// link so "Update card" can open straight onto the form.
	CreatePortalSession(ctx context.Context, customerID string, subscriptionIDs []string) (PortalSession, error)
	// GetCard returns the customer's default saved card, or nil if none.
	GetCard(ctx context.Context, customerID string) (*Card, error)
	// ListInvoices returns the customer's billed/paid transactions, newest-first.
	ListInvoices(ctx context.Context, customerID string) ([]Invoice, error)
}

// HTTPClient talks to the real Paddle Billing API.
type HTTPClient struct {
	BaseURL string
	APIKey  string
	HTTP    *http.Client
}

// NewHTTPClient builds a client. baseURL defaults to production if empty.
func NewHTTPClient(baseURL, apiKey string) *HTTPClient {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = "https://api.paddle.com"
	}
	return &HTTPClient{
		BaseURL: base,
		APIKey:  apiKey,
		HTTP:    &http.Client{Timeout: 20 * time.Second},
	}
}

// transactionResponse is the slice of Paddle's response we read.
type transactionResponse struct {
	Data struct {
		ID         string `json:"id"`
		CustomerID string `json:"customer_id"`
		Checkout   struct {
			URL string `json:"url"`
		} `json:"checkout"`
	} `json:"data"`
}

// CreateCheckout creates a draft transaction for the price and returns its
// hosted checkout URL. custom_data.user_id is always set so the webhook can map
// the resulting subscription back to the Cognos user.
func (c *HTTPClient) CreateCheckout(
	ctx context.Context,
	req CheckoutRequest,
) (CheckoutResult, error) {
	customData := map[string]any{"user_id": req.UserID}
	if req.Business != nil {
		// Mirror the business details onto the transaction so they reach the
		// invoice even before a Paddle business entity exists for the customer.
		customData["business_name"] = req.Business.Name
		customData["business_vat_id"] = req.Business.TaxID
		customData["business_country"] = req.Business.CountryCode
	}

	payload := map[string]any{
		"items":       []map[string]any{{"price_id": req.PriceID, "quantity": 1}},
		"custom_data": customData,
	}
	if req.CustomerID != "" {
		payload["customer_id"] = req.CustomerID
	}
	if req.ReturnURL != "" {
		payload["checkout"] = map[string]any{"url": req.ReturnURL}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return CheckoutResult{}, fmt.Errorf("marshal checkout payload: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.BaseURL+"/transactions", bytes.NewReader(body),
	)
	if err != nil {
		return CheckoutResult{}, fmt.Errorf("build checkout request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.APIKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return CheckoutResult{}, fmt.Errorf("call paddle: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Surface the status + a bounded body snippet (Paddle error bodies hold
		// no secrets) without leaking the request payload.
		return CheckoutResult{}, fmt.Errorf(
			"paddle transactions returned %d: %s", resp.StatusCode, snippet(respBody),
		)
	}

	var parsed transactionResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return CheckoutResult{}, fmt.Errorf("decode paddle response: %w", err)
	}
	if parsed.Data.Checkout.URL == "" {
		return CheckoutResult{}, fmt.Errorf("paddle response missing checkout url")
	}

	return CheckoutResult{
		TransactionID: parsed.Data.ID,
		CheckoutURL:   parsed.Data.Checkout.URL,
		CustomerID:    parsed.Data.CustomerID,
	}, nil
}

// portalSessionResponse is the slice of Paddle's response we read.
type portalSessionResponse struct {
	Data struct {
		URLs struct {
			General struct {
				Overview string `json:"overview"`
			} `json:"general"`
			Subscriptions []struct {
				ID                              string `json:"id"`
				UpdateSubscriptionPaymentMethod string `json:"update_subscription_payment_method"`
			} `json:"subscriptions"`
		} `json:"urls"`
	} `json:"data"`
}

// CreatePortalSession mints authenticated customer-portal links for a customer.
func (c *HTTPClient) CreatePortalSession(
	ctx context.Context,
	customerID string,
	subscriptionIDs []string,
) (PortalSession, error) {
	payload := map[string]any{}
	if len(subscriptionIDs) > 0 {
		payload["subscription_ids"] = subscriptionIDs
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return PortalSession{}, fmt.Errorf("marshal portal payload: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(
		ctx, http.MethodPost,
		c.BaseURL+"/customers/"+customerID+"/portal-sessions",
		bytes.NewReader(body),
	)
	if err != nil {
		return PortalSession{}, fmt.Errorf("build portal request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.APIKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return PortalSession{}, fmt.Errorf("call paddle: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return PortalSession{}, fmt.Errorf(
			"paddle portal-sessions returned %d: %s", resp.StatusCode, snippet(respBody),
		)
	}

	var parsed portalSessionResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return PortalSession{}, fmt.Errorf("decode paddle response: %w", err)
	}
	if parsed.Data.URLs.General.Overview == "" {
		return PortalSession{}, fmt.Errorf("paddle response missing portal overview url")
	}

	session := PortalSession{OverviewURL: parsed.Data.URLs.General.Overview}
	if len(parsed.Data.URLs.Subscriptions) > 0 {
		session.UpdatePaymentURL = parsed.Data.URLs.Subscriptions[0].UpdateSubscriptionPaymentMethod
	}
	return session, nil
}

type paymentMethodsResponse struct {
	Data []struct {
		Type string `json:"type"`
		Card struct {
			Type        string `json:"type"`
			Last4       string `json:"last4"`
			ExpiryMonth int    `json:"expiry_month"`
			ExpiryYear  int    `json:"expiry_year"`
		} `json:"card"`
	} `json:"data"`
}

// GetCard returns the customer's first saved card (display fields only).
func (c *HTTPClient) GetCard(ctx context.Context, customerID string) (*Card, error) {
	body, err := c.getJSON(ctx, c.BaseURL+"/customers/"+customerID+"/payment-methods")
	if err != nil {
		return nil, err
	}
	var parsed paymentMethodsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("decode payment methods: %w", err)
	}
	for _, method := range parsed.Data {
		if method.Type == "card" && method.Card.Last4 != "" {
			return &Card{
				Brand:       method.Card.Type,
				Last4:       method.Card.Last4,
				ExpiryMonth: method.Card.ExpiryMonth,
				ExpiryYear:  method.Card.ExpiryYear,
			}, nil
		}
	}
	return nil, nil
}

type transactionsListResponse struct {
	Data []struct {
		ID            string `json:"id"`
		InvoiceNumber string `json:"invoice_number"`
		Status        string `json:"status"`
		CurrencyCode  string `json:"currency_code"`
		BilledAt      string `json:"billed_at"`
		Details       struct {
			Totals struct {
				GrandTotal string `json:"grand_total"`
			} `json:"totals"`
		} `json:"details"`
	} `json:"data"`
}

// ListInvoices returns the customer's billed/paid transactions, newest-first.
func (c *HTTPClient) ListInvoices(ctx context.Context, customerID string) ([]Invoice, error) {
	url := c.BaseURL + "/transactions?customer_id=" + customerID +
		"&status=billed,paid,completed,past_due&order_by=billed_at[DESC]&per_page=50"
	body, err := c.getJSON(ctx, url)
	if err != nil {
		return nil, err
	}
	var parsed transactionsListResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("decode transactions: %w", err)
	}

	invoices := make([]Invoice, 0, len(parsed.Data))
	for _, txn := range parsed.Data {
		invoice := Invoice{
			ID:              txn.ID,
			InvoiceNumber:   txn.InvoiceNumber,
			Status:          txn.Status,
			CurrencyCode:    txn.CurrencyCode,
			GrandTotalMinor: parseMinorAmount(txn.Details.Totals.GrandTotal),
		}
		if txn.BilledAt != "" {
			if t, err := time.Parse(time.RFC3339, txn.BilledAt); err == nil {
				invoice.BilledAt = t.UTC()
			}
		}
		invoices = append(invoices, invoice)
	}
	return invoices, nil
}

// getJSON performs an authenticated GET and returns the response body, or an
// error for non-2xx responses (with a bounded snippet, no secrets).
func (c *HTTPClient) getJSON(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call paddle: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("paddle GET %s returned %d: %s", url, resp.StatusCode, snippet(body))
	}
	return body, nil
}

// parseMinorAmount parses Paddle's string minor-unit totals (e.g. "1000") into
// an int64, returning 0 for anything unparseable.
func parseMinorAmount(value string) int64 {
	n, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0
	}
	return n
}

// CancelSubscription schedules cancellation at the end of the current period.
func (c *HTTPClient) CancelSubscription(ctx context.Context, subscriptionID string) error {
	return c.postJSON(ctx,
		c.BaseURL+"/subscriptions/"+subscriptionID+"/cancel",
		map[string]any{"effective_from": "next_billing_period"},
	)
}

// ResumeSubscription clears a scheduled cancellation.
func (c *HTTPClient) ResumeSubscription(ctx context.Context, subscriptionID string) error {
	return c.patchJSON(ctx,
		c.BaseURL+"/subscriptions/"+subscriptionID,
		map[string]any{"scheduled_change": nil},
	)
}

func (c *HTTPClient) postJSON(ctx context.Context, url string, payload map[string]any) error {
	return c.sendJSON(ctx, http.MethodPost, url, payload)
}

func (c *HTTPClient) patchJSON(ctx context.Context, url string, payload map[string]any) error {
	return c.sendJSON(ctx, http.MethodPatch, url, payload)
}

func (c *HTTPClient) sendJSON(ctx context.Context, method, url string, payload map[string]any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("call paddle: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("paddle %s %s returned %d: %s", method, url, resp.StatusCode, snippet(respBody))
	}
	return nil
}

func snippet(b []byte) string {
	const max = 300
	s := strings.TrimSpace(string(b))
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}
