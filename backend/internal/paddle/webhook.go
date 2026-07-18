package paddle

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ErrInvalidSignature is returned when a webhook body fails HMAC verification.
var ErrInvalidSignature = errors.New("paddle: invalid webhook signature")

// VerifySignature checks a Paddle webhook against the notification-destination
// secret. Paddle signs `ts:rawBody` with HMAC-SHA256 and sends the result in
// the `Paddle-Signature` header as `ts=<unix>;h1=<hex>`. The comparison is
// constant-time. Replay is handled separately by event-id idempotency, so we
// don't enforce a timestamp window here.
func VerifySignature(secret, signatureHeader string, rawBody []byte) error {
	if secret == "" {
		return fmt.Errorf("paddle: webhook secret not configured")
	}

	ts, h1 := parseSignatureHeader(signatureHeader)
	if ts == "" || h1 == "" {
		return ErrInvalidSignature
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts))
	mac.Write([]byte(":"))
	mac.Write(rawBody)
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(h1)) {
		return ErrInvalidSignature
	}
	return nil
}

// parseSignatureHeader splits `ts=...;h1=...` into its parts. Unknown segments
// are ignored so Paddle can add new signature versions without breaking us.
func parseSignatureHeader(header string) (ts, h1 string) {
	for _, segment := range strings.Split(header, ";") {
		key, value, found := strings.Cut(strings.TrimSpace(segment), "=")
		if !found {
			continue
		}
		switch key {
		case "ts":
			ts = value
		case "h1":
			h1 = value
		}
	}
	return ts, h1
}

// WebhookEvent is the Paddle webhook envelope. Data is left raw so each handler
// decodes only the shape it needs.
type WebhookEvent struct {
	EventID   string          `json:"event_id"`
	EventType string          `json:"event_type"`
	Data      json.RawMessage `json:"data"`
}

// SubscriptionData is the subset of a Paddle subscription we act on.
type SubscriptionData struct {
	ID         string `json:"id"`
	CustomerID string `json:"customer_id"`
	Status     string `json:"status"`
	CustomData struct {
		UserID string `json:"user_id"`
	} `json:"custom_data"`
	Items []struct {
		Price struct {
			ID string `json:"id"`
		} `json:"price"`
		// Quantity is the seat count on Organisation subscriptions; personal
		// subscriptions always carry quantity 1.
		Quantity int `json:"quantity"`
	} `json:"items"`
	CurrentBillingPeriod struct {
		StartsAt string `json:"starts_at"`
		EndsAt   string `json:"ends_at"`
	} `json:"current_billing_period"`
	ScheduledChange *struct {
		Action      string `json:"action"`
		EffectiveAt string `json:"effective_at"`
	} `json:"scheduled_change"`
}

// PriceID returns the first item's price id (our plans have a single item).
func (s SubscriptionData) PriceID() string {
	if len(s.Items) == 0 {
		return ""
	}
	return s.Items[0].Price.ID
}

// TransactionData is the subset of a Paddle transaction we act on.
type TransactionData struct {
	ID             string `json:"id"`
	CustomerID     string `json:"customer_id"`
	SubscriptionID string `json:"subscription_id"`
	Status         string `json:"status"`
	CustomData     struct {
		UserID string `json:"user_id"`
	} `json:"custom_data"`
	Details struct {
		Totals struct {
			GrandTotal string `json:"grand_total"`
		} `json:"totals"`
	} `json:"details"`
	BillingPeriod struct {
		StartsAt string `json:"starts_at"`
		EndsAt   string `json:"ends_at"`
	} `json:"billing_period"`
}

// GrandTotalMinor parses the transaction's grand total (Paddle sends minor units
// as a decimal string, e.g. "1340") into an int64 Rappen value.
func (t TransactionData) GrandTotalMinor() int64 {
	return parseMinorAmount(t.Details.Totals.GrandTotal)
}

// AdjustmentData is the subset of a Paddle adjustment (refund / credit /
// chargeback) we act on.
type AdjustmentData struct {
	ID             string `json:"id"`
	Action         string `json:"action"` // refund | credit | chargeback | chargeback_reverse | ...
	TransactionID  string `json:"transaction_id"`
	SubscriptionID string `json:"subscription_id"`
	CustomerID     string `json:"customer_id"`
	Status         string `json:"status"`
	Reason         string `json:"reason"`
	Totals         struct {
		Total    string `json:"total"`
		Currency string `json:"currency_code"`
	} `json:"totals"`
}

// TotalMinor parses the adjustment's total (Paddle minor-unit decimal string)
// into an int64 Rappen value.
func (a AdjustmentData) TotalMinor() int64 {
	return parseMinorAmount(a.Totals.Total)
}

// IsChargeback reports whether this adjustment is a chargeback (treated like a
// refund but also moves the plan to inactive — spec §7.5).
func (a AdjustmentData) IsChargeback() bool {
	return a.Action == "chargeback"
}

// Adjustment decodes the event data as an adjustment.
func (e WebhookEvent) Adjustment() (AdjustmentData, error) {
	var data AdjustmentData
	if err := json.Unmarshal(e.Data, &data); err != nil {
		return AdjustmentData{}, fmt.Errorf("paddle: decode adjustment data: %w", err)
	}
	return data, nil
}

// ParseWebhook decodes the envelope.
func ParseWebhook(rawBody []byte) (WebhookEvent, error) {
	var event WebhookEvent
	if err := json.Unmarshal(rawBody, &event); err != nil {
		return WebhookEvent{}, fmt.Errorf("paddle: decode webhook envelope: %w", err)
	}
	return event, nil
}

// Subscription decodes the event data as a subscription.
func (e WebhookEvent) Subscription() (SubscriptionData, error) {
	var data SubscriptionData
	if err := json.Unmarshal(e.Data, &data); err != nil {
		return SubscriptionData{}, fmt.Errorf("paddle: decode subscription data: %w", err)
	}
	return data, nil
}

// Transaction decodes the event data as a transaction.
func (e WebhookEvent) Transaction() (TransactionData, error) {
	var data TransactionData
	if err := json.Unmarshal(e.Data, &data); err != nil {
		return TransactionData{}, fmt.Errorf("paddle: decode transaction data: %w", err)
	}
	return data, nil
}
