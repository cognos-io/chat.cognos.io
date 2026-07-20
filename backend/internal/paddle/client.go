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
	OrgID      string // Organisation id → custom_data.org_id; set INSTEAD of UserID for org subscriptions
	Quantity   int    // subscription item quantity (Seats); 0 means 1
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
	GrandTotalMinor int64  // total in the currency's minor unit (Rappen for CHF)
	Description     string // e.g. "Unlimited · monthly"; falls back to the number
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
	// GetTransactionCustomerID returns the customer a transaction belongs to, so
	// a handler can verify ownership before exposing its invoice.
	GetTransactionCustomerID(ctx context.Context, transactionID string) (string, error)
	// GetInvoicePDFURL returns a short-lived URL to a transaction's PDF invoice.
	GetInvoicePDFURL(ctx context.Context, transactionID string) (string, error)
	// ChangeSubscriptionPrice switches the subscription's single item to
	// newPriceID. prorationBillingMode controls how/when Paddle bills the change
	// (e.g. "prorated_immediately" for an upgrade, "full_next_billing_period" for
	// a downgrade/lateral switch so no money moves mid-cycle).
	ChangeSubscriptionPrice(ctx context.Context, subscriptionID, newPriceID, prorationBillingMode string) error
	// CreateOneTimeCharge posts a one-time charge on a subscription for the PAYG
	// cycle-end overage: `quantity` units of the 1-Rappen overage price, billed on
	// the next renewal transaction. idempotencyKey makes a re-post a no-op at
	// Paddle. Returns the resulting transaction id if Paddle exposes one (it often
	// doesn't until the renewal is billed), else empty.
	CreateOneTimeCharge(ctx context.Context, subscriptionID, priceID string, quantity int64, idempotencyKey string) (string, error)
}

// SeatQuantityUpdater is the narrower Paddle capability used by Organisation
// invite acceptance. Keeping it separate from Client lets handlers and tests
// depend only on the one mutating operation needed for immediate Seat
// proration.
type SeatQuantityUpdater interface {
	UpdateSubscriptionQuantity(
		ctx context.Context,
		subscriptionID, priceID string,
		quantity int,
		prorationBillingMode string,
	) error
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
	// An org checkout carries org_id ONLY — the subscription must resolve to
	// the Organisation, never to the acting owner's personal billing.
	customData := map[string]any{}
	if req.OrgID != "" {
		customData["org_id"] = req.OrgID
	} else {
		customData["user_id"] = req.UserID
	}
	if req.Business != nil {
		// Mirror the business details onto the transaction so they reach the
		// invoice even before a Paddle business entity exists for the customer.
		customData["business_name"] = req.Business.Name
		customData["business_vat_id"] = req.Business.TaxID
		customData["business_country"] = req.Business.CountryCode
	}

	quantity := req.Quantity
	if quantity <= 0 {
		quantity = 1
	}
	payload := map[string]any{
		"items":       []map[string]any{{"price_id": req.PriceID, "quantity": quantity}},
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

// GetCard returns the customer's saved card (display fields only). It prefers
// the saved payment-methods endpoint, falling back to the card on the most
// recent transaction — that's more widely available (e.g. in sandbox, or when
// the API key isn't granted payment-method read).
func (c *HTTPClient) GetCard(ctx context.Context, customerID string) (*Card, error) {
	if card, err := c.cardFromPaymentMethods(ctx, customerID); err == nil && card != nil {
		return card, nil
	}
	return c.cardFromTransactions(ctx, customerID)
}

func (c *HTTPClient) cardFromPaymentMethods(ctx context.Context, customerID string) (*Card, error) {
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

func (c *HTTPClient) cardFromTransactions(ctx context.Context, customerID string) (*Card, error) {
	url := c.BaseURL + "/transactions?customer_id=" + customerID +
		"&status=completed,billed,paid&order_by=billed_at[DESC]&per_page=20"
	body, err := c.getJSON(ctx, url)
	if err != nil {
		return nil, err
	}
	var parsed transactionsListResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("decode transactions: %w", err)
	}
	for _, txn := range parsed.Data {
		for _, payment := range txn.Payments {
			card := payment.MethodDetails.Card
			if payment.MethodDetails.Type == "card" && card.Last4 != "" {
				return &Card{
					Brand:       card.Type,
					Last4:       card.Last4,
					ExpiryMonth: card.ExpiryMonth,
					ExpiryYear:  card.ExpiryYear,
				}, nil
			}
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
		Items         []struct {
			Price struct {
				Name         string `json:"name"`
				BillingCycle *struct {
					Interval string `json:"interval"`
				} `json:"billing_cycle"`
			} `json:"price"`
		} `json:"items"`
		Details struct {
			Totals struct {
				GrandTotal string `json:"grand_total"`
			} `json:"totals"`
		} `json:"details"`
		Payments []struct {
			MethodDetails struct {
				Type string `json:"type"`
				Card struct {
					Type        string `json:"type"`
					Last4       string `json:"last4"`
					ExpiryMonth int    `json:"expiry_month"`
					ExpiryYear  int    `json:"expiry_year"`
				} `json:"card"`
			} `json:"method_details"`
		} `json:"payments"`
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
		if len(txn.Items) > 0 {
			name := strings.TrimSpace(txn.Items[0].Price.Name)
			if name != "" {
				invoice.Description = name
				if cycle := txn.Items[0].Price.BillingCycle; cycle != nil && cycle.Interval != "" {
					invoice.Description = name + " · " + intervalLabel(cycle.Interval)
				}
			}
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

// intervalLabel maps Paddle's billing interval ("month"/"year") to the
// customer-facing label we use everywhere else ("monthly"/"annual").
func intervalLabel(interval string) string {
	switch interval {
	case "month":
		return "monthly"
	case "year":
		return "annual"
	case "week":
		return "weekly"
	case "day":
		return "daily"
	default:
		return interval
	}
}

type transactionDetailResponse struct {
	Data struct {
		CustomerID string `json:"customer_id"`
	} `json:"data"`
}

// GetTransactionCustomerID returns the customer a transaction belongs to.
func (c *HTTPClient) GetTransactionCustomerID(ctx context.Context, transactionID string) (string, error) {
	body, err := c.getJSON(ctx, c.BaseURL+"/transactions/"+transactionID)
	if err != nil {
		return "", err
	}
	var parsed transactionDetailResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("decode transaction: %w", err)
	}
	return parsed.Data.CustomerID, nil
}

type invoicePDFResponse struct {
	Data struct {
		URL string `json:"url"`
	} `json:"data"`
}

// GetInvoicePDFURL returns a short-lived URL to a transaction's PDF invoice.
func (c *HTTPClient) GetInvoicePDFURL(ctx context.Context, transactionID string) (string, error) {
	body, err := c.getJSON(ctx, c.BaseURL+"/transactions/"+transactionID+"/invoice")
	if err != nil {
		return "", err
	}
	var parsed invoicePDFResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("decode invoice: %w", err)
	}
	if parsed.Data.URL == "" {
		return "", fmt.Errorf("paddle response missing invoice url")
	}
	return parsed.Data.URL, nil
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

// chargeResponse is the slice of the subscription entity Paddle returns from a
// one-time charge. The charge itself rides the next renewal transaction, so the
// only id we may see now is the previewed next_transaction's (often absent).
type chargeResponse struct {
	Data struct {
		NextTransaction struct {
			ID string `json:"id"`
		} `json:"next_transaction"`
	} `json:"data"`
}

// CreateOneTimeCharge posts the PAYG overage as a one-time charge billed on the
// next renewal (`effective_from: next_billing_period`). The overage price is a
// CHF 0.01 (1-Rappen) unit, so quantity == overage in Rappen. The
// Paddle-Idempotency-Key makes a retried post return the same charge rather than
// double-billing.
func (c *HTTPClient) CreateOneTimeCharge(
	ctx context.Context,
	subscriptionID, priceID string,
	quantity int64,
	idempotencyKey string,
) (string, error) {
	if quantity < 1 {
		return "", fmt.Errorf("paddle: one-time charge quantity must be >= 1, got %d", quantity)
	}

	payload := map[string]any{
		"effective_from": "next_billing_period",
		"items":          []map[string]any{{"price_id": priceID, "quantity": quantity}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal charge payload: %w", err)
	}

	url := c.BaseURL + "/subscriptions/" + subscriptionID + "/charge?include=next_transaction"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build charge request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	if idempotencyKey != "" {
		req.Header.Set("Paddle-Idempotency-Key", idempotencyKey)
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("call paddle: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf(
			"paddle subscriptions charge returned %d: %s", resp.StatusCode, snippet(respBody),
		)
	}

	var parsed chargeResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		// The charge succeeded (2xx); we just couldn't read an id. Not fatal.
		return "", nil
	}
	return parsed.Data.NextTransaction.ID, nil
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

// ChangeSubscriptionPrice switches the subscription onto a new single-item price.
// Paddle applies the item change immediately; prorationBillingMode decides
// whether/when it's billed.
func (c *HTTPClient) ChangeSubscriptionPrice(
	ctx context.Context,
	subscriptionID, newPriceID, prorationBillingMode string,
) error {
	return c.patchJSON(ctx,
		c.BaseURL+"/subscriptions/"+subscriptionID,
		map[string]any{
			"items":                  []map[string]any{{"price_id": newPriceID, "quantity": 1}},
			"proration_billing_mode": prorationBillingMode,
		},
	)
}

// UpdateSubscriptionQuantity replaces the Organisation subscription's single
// Seat item quantity. Paddle applies additions immediately using its native
// proration when prorationBillingMode is "prorated_immediately".
func (c *HTTPClient) UpdateSubscriptionQuantity(
	ctx context.Context,
	subscriptionID, priceID string,
	quantity int,
	prorationBillingMode string,
) error {
	if quantity < 1 {
		return fmt.Errorf("subscription quantity must be at least 1")
	}
	return c.patchJSON(ctx,
		c.BaseURL+"/subscriptions/"+subscriptionID,
		map[string]any{
			"items":                  []map[string]any{{"price_id": priceID, "quantity": quantity}},
			"proration_billing_mode": prorationBillingMode,
		},
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
