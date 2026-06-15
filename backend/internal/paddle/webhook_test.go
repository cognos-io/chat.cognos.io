package paddle

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
)

// sign produces a valid Paddle-Signature header for a body + secret + ts.
func sign(secret, ts string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts))
	mac.Write([]byte(":"))
	mac.Write(body)
	return "ts=" + ts + ";h1=" + hex.EncodeToString(mac.Sum(nil))
}

func TestVerifySignature_Valid(t *testing.T) {
	body := []byte(`{"event_id":"evt_1"}`)
	header := sign("pdl_secret", "1700000000", body)

	if err := VerifySignature("pdl_secret", header, body); err != nil {
		t.Fatalf("expected valid signature, got %v", err)
	}
}

func TestVerifySignature_Tampered(t *testing.T) {
	body := []byte(`{"event_id":"evt_1"}`)
	header := sign("pdl_secret", "1700000000", body)

	// A changed body must no longer match the signature.
	if err := VerifySignature("pdl_secret", header, []byte(`{"event_id":"evt_2"}`)); !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("expected ErrInvalidSignature for tampered body, got %v", err)
	}
}

func TestVerifySignature_WrongSecret(t *testing.T) {
	body := []byte(`{}`)
	header := sign("real_secret", "1700000000", body)

	if err := VerifySignature("other_secret", header, body); !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("expected ErrInvalidSignature for wrong secret, got %v", err)
	}
}

func TestVerifySignature_MalformedHeader(t *testing.T) {
	body := []byte(`{}`)
	for _, header := range []string{"", "garbage", "ts=1700000000", "h1=abc", "ts=;h1="} {
		if err := VerifySignature("s", header, body); err == nil {
			t.Errorf("expected error for malformed header %q", header)
		}
	}
}

func TestVerifySignature_NoSecret(t *testing.T) {
	if err := VerifySignature("", "ts=1;h1=2", []byte(`{}`)); err == nil {
		t.Fatal("expected error when secret is not configured")
	}
}

func TestParseWebhookAndDecode(t *testing.T) {
	body := []byte(`{
		"event_id": "evt_abc",
		"event_type": "subscription.created",
		"data": {
			"id": "sub_1",
			"customer_id": "ctm_1",
			"status": "active",
			"custom_data": {"user_id": "user_9"},
			"items": [{"price": {"id": "pri_unlimited"}}],
			"current_billing_period": {"starts_at": "2026-06-01T00:00:00Z", "ends_at": "2026-07-01T00:00:00Z"}
		}
	}`)

	event, err := ParseWebhook(body)
	if err != nil {
		t.Fatalf("ParseWebhook: %v", err)
	}
	if event.EventID != "evt_abc" || event.EventType != "subscription.created" {
		t.Fatalf("envelope mismatch: %+v", event)
	}

	sub, err := event.Subscription()
	if err != nil {
		t.Fatalf("Subscription: %v", err)
	}
	if sub.ID != "sub_1" || sub.CustomData.UserID != "user_9" {
		t.Errorf("subscription mismatch: %+v", sub)
	}
	if sub.PriceID() != "pri_unlimited" {
		t.Errorf("PriceID = %q, want pri_unlimited", sub.PriceID())
	}
	if sub.CurrentBillingPeriod.EndsAt != "2026-07-01T00:00:00Z" {
		t.Errorf("cycle end mismatch: %q", sub.CurrentBillingPeriod.EndsAt)
	}
}

func TestPriceIDEmptyWhenNoItems(t *testing.T) {
	if (SubscriptionData{}).PriceID() != "" {
		t.Error("PriceID should be empty when there are no items")
	}
}

func TestParseWebhookInvalidJSON(t *testing.T) {
	if _, err := ParseWebhook([]byte("not json")); err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}
