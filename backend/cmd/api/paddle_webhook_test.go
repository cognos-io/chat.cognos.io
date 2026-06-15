package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
)

const (
	webhookSecret = "whsec_test"
	testUserID    = "uvi8zmr78j9y5hz" // test1@example.com (seeded with a trial row)
)

// Bodies are signed verbatim, so keep them as exact strings.
const subscriptionCreatedBody = `{"event_id":"evt_created_1","event_type":"subscription.created",` +
	`"data":{"id":"sub_1","customer_id":"ctm_1","status":"active",` +
	`"custom_data":{"user_id":"uvi8zmr78j9y5hz"},` +
	`"items":[{"price":{"id":"pri_unl_monthly"}}],` +
	`"current_billing_period":{"starts_at":"2026-06-01T00:00:00Z","ends_at":"2026-07-01T00:00:00Z"}}}`

const subscriptionCanceledBody = `{"event_id":"evt_canceled_1","event_type":"subscription.canceled",` +
	`"data":{"id":"sub_1","customer_id":"ctm_1","status":"canceled",` +
	`"custom_data":{"user_id":"uvi8zmr78j9y5hz"}}}`

func paddleWebhookConfig() *config.APIConfig {
	c := checkoutConfig()
	c.PaddleWebhookSecret = webhookSecret
	return c
}

func signPaddle(t testing.TB, secret, body string) string {
	t.Helper()
	const ts = "1700000000"
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts))
	mac.Write([]byte(":"))
	mac.Write([]byte(body))
	return "ts=" + ts + ";h1=" + hex.EncodeToString(mac.Sum(nil))
}

// bootWebhookMux boots a test app with Paddle configured and returns its HTTP
// mux so a test can drive several requests against one app.
func bootWebhookMux(t *testing.T) (*tests.TestApp, http.Handler) {
	t.Helper()
	app := setupTestAppWithHookParams(t, appHookParams{Config: paddleWebhookConfig()})

	baseRouter, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("apis.NewRouter: %v", err)
	}

	var mux http.Handler
	serveEvent := &core.ServeEvent{App: app, Router: baseRouter}
	if err := app.OnServe().Trigger(serveEvent, func(e *core.ServeEvent) error {
		built, err := e.Router.BuildMux()
		mux = built
		return err
	}); err != nil {
		t.Fatalf("OnServe trigger: %v", err)
	}
	return app, mux
}

func postWebhook(mux http.Handler, body, signature string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/webhooks/paddle", strings.NewReader(body))
	req.Header.Set("content-type", "application/json")
	if signature != "" {
		req.Header.Set("Paddle-Signature", signature)
	}
	mux.ServeHTTP(recorder, req)
	return recorder
}

func planFor(t *testing.T, app *tests.TestApp, userID string) string {
	t.Helper()
	record, err := app.FindFirstRecordByData("user_billing", "user_id", userID)
	if err != nil {
		t.Fatalf("find user_billing for %q: %v", userID, err)
	}
	return record.GetString("plan_type")
}

func countEvents(t *testing.T, app *tests.TestApp) int64 {
	t.Helper()
	n, err := app.CountRecords("paddle_events")
	if err != nil {
		t.Fatalf("count paddle_events: %v", err)
	}
	return n
}

func TestPaddleWebhookRejectsBadSignature(t *testing.T) {
	app, mux := bootWebhookMux(t)

	rec := postWebhook(mux, subscriptionCreatedBody, "ts=1700000000;h1=deadbeef")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 — body: %s", rec.Code, rec.Body.String())
	}
	// A rejected signature must never write an event.
	if n := countEvents(t, app); n != 0 {
		t.Errorf("paddle_events count = %d, want 0 (no write on bad signature)", n)
	}
	// And the plan must be untouched.
	if plan := planFor(t, app, testUserID); plan != "trial" {
		t.Errorf("plan = %q, want trial (unchanged)", plan)
	}
}

func TestPaddleWebhookActivatesSubscription(t *testing.T) {
	app, mux := bootWebhookMux(t)

	rec := postWebhook(mux, subscriptionCreatedBody, signPaddle(t, webhookSecret, subscriptionCreatedBody))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	record, err := app.FindFirstRecordByData("user_billing", "user_id", testUserID)
	if err != nil {
		t.Fatalf("find user_billing: %v", err)
	}
	if got := record.GetString("plan_type"); got != "unlimited" {
		t.Errorf("plan_type = %q, want unlimited", got)
	}
	if got := record.GetString("paddle_subscription_id"); got != "sub_1" {
		t.Errorf("paddle_subscription_id = %q, want sub_1", got)
	}
	if got := record.GetString("paddle_price_id"); got != "pri_unl_monthly" {
		t.Errorf("paddle_price_id = %q, want pri_unl_monthly", got)
	}
	if record.GetString("refund_eligible_until_at") == "" {
		t.Error("refund_eligible_until_at should be set on activation")
	}

	// The event is recorded once and marked processed.
	event, err := app.FindFirstRecordByData("paddle_events", "paddle_event_id", "evt_created_1")
	if err != nil {
		t.Fatalf("find paddle_events: %v", err)
	}
	if event.GetString("processed_at") == "" {
		t.Error("processed_at should be set after a successful handler")
	}
}

func TestPaddleWebhookIsIdempotent(t *testing.T) {
	app, mux := bootWebhookMux(t)
	sig := signPaddle(t, webhookSecret, subscriptionCreatedBody)

	first := postWebhook(mux, subscriptionCreatedBody, sig)
	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d, want 200", first.Code)
	}

	second := postWebhook(mux, subscriptionCreatedBody, sig)
	if second.Code != http.StatusOK {
		t.Fatalf("second status = %d, want 200", second.Code)
	}
	if !strings.Contains(second.Body.String(), "duplicate") {
		t.Errorf("re-delivery should be reported as duplicate, got: %s", second.Body.String())
	}
	if n := countEvents(t, app); n != 1 {
		t.Errorf("paddle_events count = %d, want exactly 1 after replay", n)
	}
}

func TestPaddleWebhookCancelsSubscription(t *testing.T) {
	app, mux := bootWebhookMux(t)

	// Activate first so there is a subscription to cancel.
	postWebhook(mux, subscriptionCreatedBody, signPaddle(t, webhookSecret, subscriptionCreatedBody))
	if plan := planFor(t, app, testUserID); plan != "unlimited" {
		t.Fatalf("setup: plan = %q, want unlimited", plan)
	}

	rec := postWebhook(mux, subscriptionCanceledBody, signPaddle(t, webhookSecret, subscriptionCanceledBody))
	if rec.Code != http.StatusOK {
		t.Fatalf("cancel status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	if plan := planFor(t, app, testUserID); plan != "inactive" {
		t.Errorf("plan = %q, want inactive after cancellation", plan)
	}
}

func TestPaddleWebhookIgnoresUnmappableUser(t *testing.T) {
	app, mux := bootWebhookMux(t)

	// No custom_data.user_id and an unknown customer — can't be mapped.
	body := `{"event_id":"evt_orphan","event_type":"subscription.created",` +
		`"data":{"id":"sub_orphan","customer_id":"ctm_unknown","status":"active",` +
		`"items":[{"price":{"id":"pri_unl_monthly"}}]}}`

	rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body))

	// Non-retryable: accepted (event stored) but no plan change anywhere.
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}
	if plan := planFor(t, app, testUserID); plan != "trial" {
		t.Errorf("unrelated user plan = %q, want trial (unchanged)", plan)
	}
}
