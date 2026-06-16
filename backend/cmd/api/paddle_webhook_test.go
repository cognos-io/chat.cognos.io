package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
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
	c.PaddlePricePAYGOverage = "pri_payg_overage"
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
	return bootWebhookMuxWithClient(t, nil)
}

// bootWebhookMuxWithClient boots a webhook test app wired to a fake Paddle
// client so a test can assert outbound calls (e.g. the overage charge).
func bootWebhookMuxWithClient(t *testing.T, client paddle.Client) (*tests.TestApp, http.Handler) {
	t.Helper()
	app := setupTestAppWithHookParams(t, appHookParams{
		Config:       paddleWebhookConfig(),
		PaddleClient: client,
	})

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

	// The Paddle customer id is persisted on the user so the portal + invoices
	// handlers can resolve it (a new customer has none at checkout time).
	user, err := app.FindRecordById("users", testUserID)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}
	if got := user.GetString("paddle_customer_id"); got != "ctm_1" {
		t.Errorf("user paddle_customer_id = %q, want ctm_1", got)
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

// --- Phase 0: subscription.updated (snapshot refresh + PAYG cycle rollover) ---

// activatePAYG subscribes the test user to the PAYG price (pri_payg) for the
// June 2026 cycle, returning the booted app + mux.
func activatePAYG(t *testing.T) (*tests.TestApp, http.Handler) {
	return activatePAYGWithClient(t, nil)
}

// activatePAYGWithClient is activatePAYG wired to a fake Paddle client so cycle
// rollover can exercise the overage charge.
func activatePAYGWithClient(t *testing.T, client paddle.Client) (*tests.TestApp, http.Handler) {
	t.Helper()
	app, mux := bootWebhookMuxWithClient(t, client)
	body := `{"event_id":"evt_payg_create","event_type":"subscription.created",` +
		`"data":{"id":"sub_payg","customer_id":"ctm_payg","status":"active",` +
		`"custom_data":{"user_id":"uvi8zmr78j9y5hz"},` +
		`"items":[{"price":{"id":"pri_payg"}}],` +
		`"current_billing_period":{"starts_at":"2026-06-01T00:00:00Z","ends_at":"2026-07-01T00:00:00Z"}}}`
	rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body))
	if rec.Code != http.StatusOK {
		t.Fatalf("activate PAYG status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}
	if plan := planFor(t, app, testUserID); plan != "payg" {
		t.Fatalf("setup: plan = %q, want payg", plan)
	}
	return app, mux
}

// seedUsage inserts a `usage` ledger row for the test user at occurredAt with
// the given user-facing cost, so a cycle close can total it.
func seedUsage(t *testing.T, app *tests.TestApp, occurredAt time.Time, userCostRappen int64) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("balance_transactions")
	if err != nil {
		t.Fatalf("find balance_transactions: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("user_id", testUserID)
	record.Set("type", "usage")
	record.Set("occurred_at", occurredAt.UTC())
	record.Set("event_id", fmt.Sprintf("evt_seed_%d_%d", occurredAt.UnixNano(), userCostRappen))
	record.Set("amount_rappen", -userCostRappen)
	record.Set("user_cost_rappen", userCostRappen)
	record.Set("model_id", "test-model")
	if err := app.Save(record); err != nil {
		t.Fatalf("seed usage row: %v", err)
	}
}

// rolloverBody advances the PAYG subscription to the July cycle.
const paygRolloverBody = `{"event_id":"evt_payg_rollover","event_type":"subscription.updated",` +
	`"data":{"id":"sub_payg","customer_id":"ctm_payg","status":"active",` +
	`"custom_data":{"user_id":"uvi8zmr78j9y5hz"},` +
	`"items":[{"price":{"id":"pri_payg"}}],` +
	`"current_billing_period":{"starts_at":"2026-07-01T00:00:00Z","ends_at":"2026-08-01T00:00:00Z"}}}`

func cycleSummaryFor(t *testing.T, app *tests.TestApp, subID string) *core.Record {
	t.Helper()
	records, err := app.FindRecordsByFilter(
		"payg_cycle_summaries", "paddle_subscription_id = {:s}", "", 10, 0,
		map[string]any{"s": subID},
	)
	if err != nil {
		t.Fatalf("find payg_cycle_summaries: %v", err)
	}
	if len(records) == 0 {
		return nil
	}
	if len(records) > 1 {
		t.Fatalf("expected at most one cycle summary, got %d", len(records))
	}
	return records[0]
}

func TestPaddleWebhookUpdatedRollsOverPaygCycle(t *testing.T) {
	app, mux := activatePAYG(t)

	// CHF 23.40 of usage in the closing (June) cycle → expect a CHF 13.40 overage.
	seedUsage(t, app, time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC), 2000)
	seedUsage(t, app, time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC), 340)
	// A row outside the cycle must not be counted.
	seedUsage(t, app, time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC), 9999)

	rec := postWebhook(mux, paygRolloverBody, signPaddle(t, webhookSecret, paygRolloverBody))
	if rec.Code != http.StatusOK {
		t.Fatalf("rollover status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	summary := cycleSummaryFor(t, app, "sub_payg")
	if summary == nil {
		t.Fatal("expected a payg_cycle_summaries row after rollover")
	}
	if got := summary.GetInt("local_usage_rappen"); got != 2340 {
		t.Errorf("local_usage_rappen = %d, want 2340", got)
	}
	if got := summary.GetInt("local_expected_bill_rappen"); got != 2340 {
		t.Errorf("local_expected_bill_rappen = %d, want 2340", got)
	}
	if got := summary.GetInt("overage_charge_rappen"); got != 1340 {
		t.Errorf("overage_charge_rappen = %d, want 1340", got)
	}

	// The user_billing snapshot advanced to the new cycle.
	billingRec, err := app.FindFirstRecordByData("user_billing", "user_id", testUserID)
	if err != nil {
		t.Fatalf("find user_billing: %v", err)
	}
	if got := billingRec.GetDateTime("paddle_cycle_start_at").Time().UTC(); !got.Equal(time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("paddle_cycle_start_at = %s, want 2026-07-01", got)
	}
}

func TestPaddleWebhookRolloverIsIdempotent(t *testing.T) {
	app, mux := activatePAYG(t)
	seedUsage(t, app, time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC), 500)

	sig := signPaddle(t, webhookSecret, paygRolloverBody)
	if rec := postWebhook(mux, paygRolloverBody, sig); rec.Code != http.StatusOK {
		t.Fatalf("first rollover status = %d, want 200", rec.Code)
	}
	// A re-delivered rollover (same event id) is a webhook-level duplicate.
	if rec := postWebhook(mux, paygRolloverBody, sig); rec.Code != http.StatusOK {
		t.Fatalf("replay status = %d, want 200", rec.Code)
	}

	n, err := app.CountRecords("payg_cycle_summaries")
	if err != nil {
		t.Fatalf("count payg_cycle_summaries: %v", err)
	}
	if n != 1 {
		t.Errorf("payg_cycle_summaries count = %d, want exactly 1", n)
	}
}

func TestPaddleWebhookRolloverPostsOverageCharge(t *testing.T) {
	fake := &fakePaddleClient{chargeTxnID: "txn_overage_1"}
	app, mux := activatePAYGWithClient(t, fake)

	// CHF 23.40 usage in the June cycle → CHF 13.40 overage (1340 rappen).
	seedUsage(t, app, time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC), 2340)

	if rec := postWebhook(mux, paygRolloverBody, signPaddle(t, webhookSecret, paygRolloverBody)); rec.Code != http.StatusOK {
		t.Fatalf("rollover status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	if fake.chargeCalls != 1 {
		t.Fatalf("CreateOneTimeCharge calls = %d, want 1", fake.chargeCalls)
	}
	if fake.chargeSubID != "sub_payg" {
		t.Errorf("charge subscription = %q, want sub_payg", fake.chargeSubID)
	}
	if fake.chargePriceID != "pri_payg_overage" {
		t.Errorf("charge price = %q, want pri_payg_overage", fake.chargePriceID)
	}
	if fake.chargeQuantity != 1340 {
		t.Errorf("charge quantity = %d, want 1340", fake.chargeQuantity)
	}

	summary := cycleSummaryFor(t, app, "sub_payg")
	if summary == nil {
		t.Fatal("expected a cycle summary")
	}
	if want := "overage_" + summary.Id; fake.chargeIdemKey != want {
		t.Errorf("idempotency key = %q, want %q", fake.chargeIdemKey, want)
	}
	if got := summary.GetString("paddle_overage_txn_id"); got != "txn_overage_1" {
		t.Errorf("paddle_overage_txn_id = %q, want txn_overage_1", got)
	}
}

func TestPaddleWebhookRolloverWithinCommitPostsNothing(t *testing.T) {
	fake := &fakePaddleClient{}
	app, mux := activatePAYGWithClient(t, fake)

	// CHF 3.42 usage — under the CHF 10 commit, so no overage charge.
	seedUsage(t, app, time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC), 342)

	if rec := postWebhook(mux, paygRolloverBody, signPaddle(t, webhookSecret, paygRolloverBody)); rec.Code != http.StatusOK {
		t.Fatalf("rollover status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	if fake.chargeCalls != 0 {
		t.Errorf("CreateOneTimeCharge calls = %d, want 0 (within commit)", fake.chargeCalls)
	}
	summary := cycleSummaryFor(t, app, "sub_payg")
	if summary == nil {
		t.Fatal("expected a cycle summary")
	}
	if got := summary.GetInt("overage_charge_rappen"); got != 0 {
		t.Errorf("overage_charge_rappen = %d, want 0", got)
	}
	if got := summary.GetString("paddle_overage_txn_id"); got != "" {
		t.Errorf("paddle_overage_txn_id = %q, want empty (no charge)", got)
	}
}

func TestPaddleWebhookRolloverChargeFailureStillAdvancesCycle(t *testing.T) {
	fake := &fakePaddleClient{chargeErr: context.DeadlineExceeded}
	app, mux := activatePAYGWithClient(t, fake)
	seedUsage(t, app, time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC), 2340)

	// A Paddle charge failure must not fail the webhook — the summary persists
	// (reconciled=false, no txn id) for the backstop, and the cycle still advances.
	if rec := postWebhook(mux, paygRolloverBody, signPaddle(t, webhookSecret, paygRolloverBody)); rec.Code != http.StatusOK {
		t.Fatalf("rollover status = %d, want 200 despite charge failure — body: %s", rec.Code, rec.Body.String())
	}

	summary := cycleSummaryFor(t, app, "sub_payg")
	if summary == nil {
		t.Fatal("expected a cycle summary even when the charge failed")
	}
	if got := summary.GetString("paddle_overage_txn_id"); got != "" {
		t.Errorf("paddle_overage_txn_id = %q, want empty after a failed charge", got)
	}
	if summary.GetBool("reconciled") {
		t.Error("reconciled should be false after a failed charge")
	}
	billingRec, err := app.FindFirstRecordByData("user_billing", "user_id", testUserID)
	if err != nil {
		t.Fatalf("find user_billing: %v", err)
	}
	if got := billingRec.GetDateTime("paddle_cycle_start_at").Time().UTC(); !got.Equal(time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("cycle did not advance: paddle_cycle_start_at = %s, want 2026-07-01", got)
	}
}

func TestPaddleWebhookUpdatedSurfacesScheduledCancel(t *testing.T) {
	app, mux := activatePAYG(t)

	body := `{"event_id":"evt_sched_cancel","event_type":"subscription.updated",` +
		`"data":{"id":"sub_payg","customer_id":"ctm_payg","status":"active",` +
		`"custom_data":{"user_id":"uvi8zmr78j9y5hz"},` +
		`"items":[{"price":{"id":"pri_payg"}}],` +
		`"current_billing_period":{"starts_at":"2026-06-01T00:00:00Z","ends_at":"2026-07-01T00:00:00Z"},` +
		`"scheduled_change":{"action":"cancel","effective_at":"2026-07-01T00:00:00Z"}}}`

	if rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body)); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	billingRec, err := app.FindFirstRecordByData("user_billing", "user_id", testUserID)
	if err != nil {
		t.Fatalf("find user_billing: %v", err)
	}
	if billingRec.GetString("plan_ends_at") == "" {
		t.Error("plan_ends_at should be set from a scheduled cancellation")
	}
	// Same period (no rollover) → no cycle summary written.
	if summary := cycleSummaryFor(t, app, "sub_payg"); summary != nil {
		t.Error("no cycle summary expected without a rollover")
	}
}

func TestPaddleWebhookMarksAndClearsPastDue(t *testing.T) {
	app, mux := bootWebhookMux(t)

	// Activate (unlimited, sub_1) so there's a subscription to dun.
	postWebhook(mux, subscriptionCreatedBody, signPaddle(t, webhookSecret, subscriptionCreatedBody))

	pastDueBody := `{"event_id":"evt_past_due_1","event_type":"subscription.past_due",` +
		`"data":{"id":"sub_1","customer_id":"ctm_1","status":"past_due",` +
		`"custom_data":{"user_id":"uvi8zmr78j9y5hz"}}}`
	if rec := postWebhook(mux, pastDueBody, signPaddle(t, webhookSecret, pastDueBody)); rec.Code != http.StatusOK {
		t.Fatalf("past_due status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	record, err := app.FindFirstRecordByData("user_billing", "user_id", testUserID)
	if err != nil {
		t.Fatalf("find user_billing: %v", err)
	}
	if !record.GetBool("past_due") {
		t.Error("past_due should be true after a failed renewal")
	}
	// The plan keeps working through the grace window.
	if got := record.GetString("plan_type"); got != "unlimited" {
		t.Errorf("plan_type = %q, want unlimited (access continues during dunning)", got)
	}

	// Dunning recovery: subscription.activated clears the flag.
	recoverBody := `{"event_id":"evt_recover_1","event_type":"subscription.activated",` +
		`"data":{"id":"sub_1","customer_id":"ctm_1","status":"active",` +
		`"custom_data":{"user_id":"uvi8zmr78j9y5hz"},` +
		`"items":[{"price":{"id":"pri_unl_monthly"}}],` +
		`"current_billing_period":{"starts_at":"2026-07-01T00:00:00Z","ends_at":"2026-08-01T00:00:00Z"}}}`
	if rec := postWebhook(mux, recoverBody, signPaddle(t, webhookSecret, recoverBody)); rec.Code != http.StatusOK {
		t.Fatalf("recover status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	record, err = app.FindFirstRecordByData("user_billing", "user_id", testUserID)
	if err != nil {
		t.Fatalf("find user_billing: %v", err)
	}
	if record.GetBool("past_due") {
		t.Error("past_due should be cleared after dunning recovery")
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
