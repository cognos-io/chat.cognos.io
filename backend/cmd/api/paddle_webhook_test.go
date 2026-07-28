package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
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
	return signPaddleAt(t, secret, body, time.Now().Unix())
}

func signPaddleAt(t testing.TB, secret, body string, timestamp int64) string {
	t.Helper()
	ts := strconv.FormatInt(timestamp, 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts))
	mac.Write([]byte(":"))
	mac.Write([]byte(body))
	return "ts=" + ts + ";h1=" + hex.EncodeToString(mac.Sum(nil))
}

func TestPaddleWebhookRejectsStaleSignedEventBeforeWriting(t *testing.T) {
	app, mux := bootWebhookMux(t)
	signature := signPaddleAt(
		t, webhookSecret, subscriptionCreatedBody,
		time.Now().Add(-paddle.DefaultWebhookTimestampTolerance-time.Second).Unix(),
	)

	rec := postWebhook(mux, subscriptionCreatedBody, signature)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 — body: %s", rec.Code, rec.Body.String())
	}
	if n := countEvents(t, app); n != 0 {
		t.Errorf("paddle_events count = %d, want 0 (no write on stale signature)", n)
	}
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
	record.Set("amount_microrappen", -userCostRappen*billing.MicroRappenPerRappen)
	record.Set("user_cost_microrappen", userCostRappen*billing.MicroRappenPerRappen)
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

	// CHF 23.40 of usage in the closing (June) cycle → expect a CHF 8.40 overage.
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
	if got := summary.GetInt("overage_charge_rappen"); got != 840 {
		t.Errorf("overage_charge_rappen = %d, want 840", got)
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

	// CHF 23.40 usage in the June cycle → CHF 8.40 overage (840 rappen).
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
	if fake.chargeQuantity != 840 {
		t.Errorf("charge quantity = %d, want 840", fake.chargeQuantity)
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

	// CHF 3.42 usage — under the CHF 15 commit, so no overage charge.
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

func TestPaddleWebhookTransactionCompletedRecordsCycle(t *testing.T) {
	app, mux := activatePAYG(t)
	// Roll over so a closed cycle summary exists for sub_payg (June cycle).
	seedUsage(t, app, time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC), 1500)
	postWebhook(mux, paygRolloverBody, signPaddle(t, webhookSecret, paygRolloverBody))

	summary := cycleSummaryFor(t, app, "sub_payg")
	if summary == nil {
		t.Fatal("setup: expected a cycle summary after rollover")
	}

	// Paddle bills the cycle (commit + overage). grand_total is minor units.
	txnBody := `{"event_id":"evt_txn_done","event_type":"transaction.completed",` +
		`"data":{"id":"txn_cycle_1","subscription_id":"sub_payg","status":"completed",` +
		`"details":{"totals":{"grand_total":"1500"}}}}`
	if rec := postWebhook(mux, txnBody, signPaddle(t, webhookSecret, txnBody)); rec.Code != http.StatusOK {
		t.Fatalf("transaction.completed status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	summary = cycleSummaryFor(t, app, "sub_payg")
	if got := summary.GetString("paddle_transaction_id"); got != "txn_cycle_1" {
		t.Errorf("paddle_transaction_id = %q, want txn_cycle_1", got)
	}
	if got := summary.GetInt("paddle_billed_rappen"); got != 1500 {
		t.Errorf("paddle_billed_rappen = %d, want 1500", got)
	}
	// Billed (1500) >= local expected (max(1500,1500)=1500) → reconciled.
	if !summary.GetBool("reconciled") {
		t.Error("reconciled should be true when Paddle billed at least the expected amount")
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

func TestPaddleWebhookAdjustmentRecordsRefund(t *testing.T) {
	app, mux := bootWebhookMux(t)
	// Activate (unlimited, sub_1) so the adjustment maps to a user via the sub.
	postWebhook(mux, subscriptionCreatedBody, signPaddle(t, webhookSecret, subscriptionCreatedBody))

	body := `{"event_id":"evt_adj_refund","event_type":"adjustment.created",` +
		`"data":{"id":"adj_1","action":"refund","transaction_id":"txn_inv_1",` +
		`"subscription_id":"sub_1","customer_id":"ctm_1","reason":"changed mind",` +
		`"totals":{"total":"10000","currency_code":"CHF"}}}`
	if rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body)); rec.Code != http.StatusOK {
		t.Fatalf("adjustment status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	refunds, err := app.FindRecordsByFilter("refunds", "user_id = {:u}", "", 10, 0, map[string]any{"u": testUserID})
	if err != nil {
		t.Fatalf("find refunds: %v", err)
	}
	if len(refunds) != 1 {
		t.Fatalf("refunds count = %d, want 1", len(refunds))
	}
	r := refunds[0]
	if got := r.GetInt("gross_refund_rappen"); got != 10000 {
		t.Errorf("gross_refund_rappen = %d, want 10000", got)
	}
	if !r.GetBool("inside_guarantee_window") {
		t.Error("inside_guarantee_window should be true (activation set a 14-day window)")
	}
	if got := r.GetString("paddle_adjustment_ids_json"); !strings.Contains(got, "adj_1") || !strings.Contains(got, "txn_inv_1") {
		t.Errorf("paddle_adjustment_ids_json = %q, want adj_1 + txn_inv_1", got)
	}

	// One-refund-per-lifetime flag set.
	user, _ := app.FindRecordById("users", testUserID)
	if !user.GetBool("refund_used") {
		t.Error("users.refund_used should be true after a refund")
	}

	// Re-delivery is a no-op (idempotent on the adjustment id).
	postWebhook(mux, body, signPaddle(t, webhookSecret, body))
	n, _ := app.CountRecords("refunds")
	if n != 1 {
		t.Errorf("refunds count after replay = %d, want 1", n)
	}
}

func TestPaddleWebhookChargebackDeactivates(t *testing.T) {
	app, mux := bootWebhookMux(t)
	postWebhook(mux, subscriptionCreatedBody, signPaddle(t, webhookSecret, subscriptionCreatedBody))
	if plan := planFor(t, app, testUserID); plan != "unlimited" {
		t.Fatalf("setup: plan = %q, want unlimited", plan)
	}

	body := `{"event_id":"evt_adj_cb","event_type":"adjustment.created",` +
		`"data":{"id":"adj_cb","action":"chargeback","transaction_id":"txn_inv_2",` +
		`"subscription_id":"sub_1","customer_id":"ctm_1",` +
		`"totals":{"total":"10000","currency_code":"CHF"}}}`
	if rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body)); rec.Code != http.StatusOK {
		t.Fatalf("chargeback status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	if plan := planFor(t, app, testUserID); plan != "inactive" {
		t.Errorf("plan = %q, want inactive after chargeback", plan)
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

// ---------------------------------------------------------------------------
// Per-user fallback pin tests (§3 PIN-TEST Plan)
// ---------------------------------------------------------------------------

func TestPaddleWebhookActivateFallbackToCustomerID(t *testing.T) {
	app, mux := bootWebhookMux(t)

	// Pre-seed the test user with a paddle_customer_id but no custom_data in webhook.
	user, _ := app.FindRecordById("users", testUserID)
	user.Set("paddle_customer_id", "ctm_fallback_1")
	if err := app.Save(user); err != nil {
		t.Fatalf("seed user paddle_customer_id: %v", err)
	}

	body := `{"event_id":"evt_fb_create","event_type":"subscription.created",` +
		`"data":{"id":"sub_fb_1","customer_id":"ctm_fallback_1","status":"active",` +
		`"items":[{"price":{"id":"pri_unl_monthly"}}],` +
		`"current_billing_period":{"starts_at":"2026-06-01T00:00:00Z","ends_at":"2026-07-01T00:00:00Z"}}}`

	rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body))
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
	if got := record.GetString("paddle_subscription_id"); got != "sub_fb_1" {
		t.Errorf("paddle_subscription_id = %q, want sub_fb_1", got)
	}
}

func TestPaddleWebhookUpdateFallsBackToSubscriptionID(t *testing.T) {
	app, mux := bootWebhookMux(t)

	// Activate with custom_data.user_id.
	activateBody := `{"event_id":"evt_fb_act","event_type":"subscription.created",` +
		`"data":{"id":"sub_fb_2","customer_id":"ctm_fb_2","status":"active",` +
		`"custom_data":{"user_id":"uvi8zmr78j9y5hz"},` +
		`"items":[{"price":{"id":"pri_payg"}}],` +
		`"current_billing_period":{"starts_at":"2026-06-01T00:00:00Z","ends_at":"2026-07-01T00:00:00Z"}}}`
	postWebhook(mux, activateBody, signPaddle(t, webhookSecret, activateBody))
	if plan := planFor(t, app, testUserID); plan != "payg" {
		t.Fatalf("setup: plan = %q, want payg", plan)
	}

	// Now post an update with a DIFFERENT custom_data.user_id but SAME subscription_id.
	updateBody := `{"event_id":"evt_fb_upd","event_type":"subscription.updated",` +
		`"data":{"id":"sub_fb_2","customer_id":"ctm_fb_2","status":"active",` +
		`"custom_data":{"user_id":"unknown_user_id_xyz"},` +
		`"items":[{"price":{"id":"pri_payg"}}],` +
		`"current_billing_period":{"starts_at":"2026-07-01T00:00:00Z","ends_at":"2026-08-01T00:00:00Z"}}}`

	rec := postWebhook(mux, updateBody, signPaddle(t, webhookSecret, updateBody))
	if rec.Code != http.StatusOK {
		t.Fatalf("update status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	// The cycle should have advanced for the original user (subscription_id matched).
	billingRec, err := app.FindFirstRecordByData("user_billing", "user_id", testUserID)
	if err != nil {
		t.Fatalf("find user_billing: %v", err)
	}
	if got := billingRec.GetDateTime("paddle_cycle_start_at").Time().UTC(); !got.Equal(time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("paddle_cycle_start_at = %s, want 2026-07-01", got)
	}
}

func TestPaddleWebhookAdjustmentFallsBackToCustomerID(t *testing.T) {
	app, mux := bootWebhookMux(t)

	// Activate user with a known paddle_customer_id.
	activateBody := `{"event_id":"evt_fb_adj_act","event_type":"subscription.created",` +
		`"data":{"id":"sub_fb_3","customer_id":"ctm_fb_3","status":"active",` +
		`"custom_data":{"user_id":"uvi8zmr78j9y5hz"},` +
		`"items":[{"price":{"id":"pri_unl_monthly"}}],` +
		`"current_billing_period":{"starts_at":"2026-06-01T00:00:00Z","ends_at":"2026-07-01T00:00:00Z"}}}`
	postWebhook(mux, activateBody, signPaddle(t, webhookSecret, activateBody))

	// Post adjustment with a DIFFERENT subscription_id but SAME customer_id.
	adjBody := `{"event_id":"evt_fb_adj","event_type":"adjustment.created",` +
		`"data":{"id":"adj_fb_1","action":"refund","transaction_id":"txn_fb_1",` +
		`"subscription_id":"sub_unknown_xyz","customer_id":"ctm_fb_3","reason":"changed mind",` +
		`"totals":{"total":"5000","currency_code":"CHF"}}}`

	rec := postWebhook(mux, adjBody, signPaddle(t, webhookSecret, adjBody))
	if rec.Code != http.StatusOK {
		t.Fatalf("adjustment status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	refunds, err := app.FindRecordsByFilter("refunds", "user_id = {:u}", "", 10, 0, map[string]any{"u": testUserID})
	if err != nil {
		t.Fatalf("find refunds: %v", err)
	}
	if len(refunds) != 1 {
		t.Fatalf("refunds count = %d, want 1", len(refunds))
	}
	if got := refunds[0].GetInt("gross_refund_rappen"); got != 5000 {
		t.Errorf("gross_refund_rappen = %d, want 5000", got)
	}
}
