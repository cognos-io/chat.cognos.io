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

// Client is the Paddle surface the billing handlers depend on.
type Client interface {
	CreateCheckout(ctx context.Context, req CheckoutRequest) (CheckoutResult, error)
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

func snippet(b []byte) string {
	const max = 300
	s := strings.TrimSpace(string(b))
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}
