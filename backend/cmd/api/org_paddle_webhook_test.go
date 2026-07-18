package main

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

const (
	testOrgID           = "org_test_001"
	testOrgCustomerID   = "ctm_org_1"
	testOrgSubscription = "sub_org_1"
	testOrgOwnerID      = testUserID // reuse seeded test user as org owner
)

// ---------------------------------------------------------------------------
// Org fixture helpers
// ---------------------------------------------------------------------------

// createTestOrg creates an organisations row plus an owner membership and
// returns the organisation record id (which is the PocketBase record id).
func createTestOrg(t *testing.T, app *tests.TestApp) string {
	t.Helper()

	orgColl, err := app.FindCollectionByNameOrId("organisations")
	if err != nil {
		t.Fatalf("find organisations collection: %v", err)
	}
	org := core.NewRecord(orgColl)
	org.Set("name", "Test Org")
	org.Set("owner", testOrgOwnerID)
	if err := app.Save(org); err != nil {
		t.Fatalf("save organisations row: %v", err)
	}

	membershipColl, err := app.FindCollectionByNameOrId("org_memberships")
	if err != nil {
		t.Fatalf("find org_memberships collection: %v", err)
	}
	membership := core.NewRecord(membershipColl)
	membership.Set("organisation", org.Id)
	membership.Set("user", testOrgOwnerID)
	membership.Set("role", "owner")
	membership.Set("added_at", time.Now().UTC())
	if err := app.Save(membership); err != nil {
		t.Fatalf("save org_memberships row: %v", err)
	}

	return org.Id
}

// orgBillingFor fetches the org_billing record for the given org id.
func orgBillingFor(t *testing.T, app *tests.TestApp, orgID string) *core.Record {
	t.Helper()
	rec, err := app.FindFirstRecordByData("org_billing", "organisation", orgID)
	if err != nil {
		t.Fatalf("find org_billing for %q: %v", orgID, err)
	}
	return rec
}

// orgCycleSummaryFor fetches the unique org_cycle_summaries row for a subscription.
func orgCycleSummaryFor(t *testing.T, app *tests.TestApp, subID string) *core.Record {
	t.Helper()
	records, err := app.FindRecordsByFilter(
		"org_cycle_summaries", "paddle_subscription_id = {:s}", "", 10, 0,
		map[string]any{"s": subID},
	)
	if err != nil {
		t.Fatalf("find org_cycle_summaries: %v", err)
	}
	if len(records) == 0 {
		return nil
	}
	if len(records) > 1 {
		t.Fatalf("expected at most one org cycle summary, got %d", len(records))
	}
	return records[0]
}

// seedOrgUsage inserts a balance_transactions row attributed to an organisation.
func seedOrgUsage(t *testing.T, app *tests.TestApp, orgID string, occurredAt time.Time, userCostRappen int64) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("balance_transactions")
	if err != nil {
		t.Fatalf("find balance_transactions: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("user_id", testOrgOwnerID)
	record.Set("organisation", orgID)
	record.Set("type", "usage")
	record.Set("occurred_at", occurredAt.UTC())
	record.Set("event_id", fmt.Sprintf("evt_seed_org_%d_%d", occurredAt.UnixNano(), userCostRappen))
	record.Set("amount_rappen", -userCostRappen)
	record.Set("user_cost_rappen", userCostRappen)
	record.Set("amount_microrappen", -userCostRappen*billing.MicroRappenPerRappen)
	record.Set("user_cost_microrappen", userCostRappen*billing.MicroRappenPerRappen)
	record.Set("model_id", "test-model")
	if err := app.Save(record); err != nil {
		t.Fatalf("seed org usage row: %v", err)
	}
}

// activateOrgPAYG creates an org, posts subscription.created with custom_data.org_id,
// and returns app, mux, and the org PB record id.
func activateOrgPAYG(t *testing.T) (*tests.TestApp, http.Handler, string) {
	return activateOrgPAYGWithClient(t, nil)
}

func activateOrgPAYGWithClient(t *testing.T, client paddle.Client) (*tests.TestApp, http.Handler, string) {
	t.Helper()
	app, mux := bootWebhookMuxWithClient(t, client)
	orgID := createTestOrg(t, app)

	body := `{"event_id":"evt_org_create","event_type":"subscription.created",` +
		`"data":{"id":"sub_org_1","customer_id":"ctm_org_1","status":"active",` +
		`"custom_data":{"org_id":"` + orgID + `"},` +
		`"items":[{"price":{"id":"pri_payg"},"quantity":1}],` +
		`"current_billing_period":{"starts_at":"2026-06-01T00:00:00Z","ends_at":"2026-07-01T00:00:00Z"}}}`

	rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body))
	if rec.Code != http.StatusOK {
		t.Fatalf("activate org PAYG status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	return app, mux, orgID
}

const orgRolloverBody = `{"event_id":"evt_org_rollover","event_type":"subscription.updated",` +
	`"data":{"id":"sub_org_1","customer_id":"ctm_org_1","status":"active",` +
	`"custom_data":{"org_id":"DYNAMIC_ORG_ID"},` +
	`"items":[{"price":{"id":"pri_payg"},"quantity":DYNAMIC_QTY}],` +
	`"current_billing_period":{"starts_at":"2026-07-01T00:00:00Z","ends_at":"2026-08-01T00:00:00Z"}}}`

// orgRolloverFor fills the dynamic placeholders in orgRolloverBody.
func orgRolloverFor(orgID string, qty int) string {
	return strings.ReplaceAll(
		strings.ReplaceAll(orgRolloverBody, "DYNAMIC_ORG_ID", orgID),
		"DYNAMIC_QTY", fmt.Sprintf("%d", qty),
	)
}

// ---------------------------------------------------------------------------
// Org-specific tests
// ---------------------------------------------------------------------------

func TestOrgPaddleWebhookActivatesOrgSubscription(t *testing.T) {
	app, mux := bootWebhookMux(t)
	orgID := createTestOrg(t, app)

	body := `{"event_id":"evt_org_create","event_type":"subscription.created",` +
		`"data":{"id":"sub_org_1","customer_id":"ctm_org_1","status":"active",` +
		`"custom_data":{"org_id":"` + orgID + `"},` +
		`"items":[{"price":{"id":"pri_payg"},"quantity":1}],` +
		`"current_billing_period":{"starts_at":"2026-06-01T00:00:00Z","ends_at":"2026-07-01T00:00:00Z"}}}`

	rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	ob := orgBillingFor(t, app, orgID)
	if got := ob.GetString("plan_type"); got != "payg" {
		t.Errorf("plan_type = %q, want payg", got)
	}
	if got := ob.GetInt("seat_quantity"); got != 1 {
		t.Errorf("seat_quantity = %d, want 1", got)
	}
	if got := ob.GetString("paddle_subscription_id"); got != "sub_org_1" {
		t.Errorf("paddle_subscription_id = %q, want sub_org_1", got)
	}
	if got := ob.GetString("paddle_price_id"); got != "pri_payg" {
		t.Errorf("paddle_price_id = %q, want pri_payg", got)
	}
	if got := ob.GetString("paddle_customer_id"); got != "ctm_org_1" {
		t.Errorf("paddle_customer_id = %q, want ctm_org_1", got)
	}

	// The owner's personal user_billing (seeded at signup) must be untouched:
	// the org subscription never attaches to a personal plan.
	if ub, err := app.FindFirstRecordByData("user_billing", "user_id", testOrgOwnerID); err == nil {
		if got := ub.GetString("paddle_subscription_id"); got == "sub_org_1" {
			t.Errorf("org subscription attached to owner's personal billing (paddle_subscription_id = %q)", got)
		}
		if got := ub.GetString("plan_type"); got == "payg" || got == "unlimited" {
			t.Errorf("owner's personal plan_type changed to %q by org activation", got)
		}
	}

	// Customer id persisted on the organisation record.
	org, _ := app.FindRecordById("organisations", orgID)
	if got := org.GetString("paddle_customer_id"); got != "ctm_org_1" {
		t.Errorf("organisations.paddle_customer_id = %q, want ctm_org_1", got)
	}
}

func TestOrgPaddleWebhookSeatQuantitySync(t *testing.T) {
	app, mux, orgID := activateOrgPAYG(t)

	// Post subscription.updated with quantity bumped to 3.
	body := `{"event_id":"evt_org_qty","event_type":"subscription.updated",` +
		`"data":{"id":"sub_org_1","customer_id":"ctm_org_1","status":"active",` +
		`"custom_data":{"org_id":"` + orgID + `"},` +
		`"items":[{"price":{"id":"pri_payg"},"quantity":3}],` +
		`"current_billing_period":{"starts_at":"2026-06-01T00:00:00Z","ends_at":"2026-07-01T00:00:00Z"}}}`

	if rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body)); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	ob := orgBillingFor(t, app, orgID)
	if got := ob.GetInt("seat_quantity"); got != 3 {
		t.Errorf("seat_quantity = %d, want 3", got)
	}
}

func TestOrgPaddleWebhookPooledOverage(t *testing.T) {
	fake := &fakePaddleClient{chargeTxnID: "txn_org_overage_1"}
	app, mux, orgID := activateOrgPAYGWithClient(t, fake)

	// Set seat_quantity to 3 for a floor of 4500 rappen.
	ob := orgBillingFor(t, app, orgID)
	ob.Set("seat_quantity", 3)
	if err := app.Save(ob); err != nil {
		t.Fatalf("set seat_quantity: %v", err)
	}

	// Seed CHF 52.00 (5200 rappen) of org usage → overage = 5200 - 4500 = 700.
	seedOrgUsage(t, app, orgID, time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC), 3000)
	seedOrgUsage(t, app, orgID, time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC), 2200)

	rollover := orgRolloverFor(orgID, 3)
	if rec := postWebhook(mux, rollover, signPaddle(t, webhookSecret, rollover)); rec.Code != http.StatusOK {
		t.Fatalf("rollover status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	if fake.chargeCalls != 1 {
		t.Fatalf("CreateOneTimeCharge calls = %d, want 1", fake.chargeCalls)
	}
	if fake.chargeQuantity != 700 {
		t.Errorf("charge quantity = %d, want 700", fake.chargeQuantity)
	}

	summary := orgCycleSummaryFor(t, app, "sub_org_1")
	if summary == nil {
		t.Fatal("expected an org_cycle_summaries row")
	}
	if got := summary.GetInt("pooled_usage_rappen"); got != 5200 {
		t.Errorf("pooled_usage_rappen = %d, want 5200", got)
	}
	if got := summary.GetInt("overage_charge_rappen"); got != 700 {
		t.Errorf("overage_charge_rappen = %d, want 700", got)
	}
	if got := summary.GetInt("seat_quantity"); got != 3 {
		t.Errorf("seat_quantity = %d, want 3", got)
	}
	if got := summary.GetString("paddle_overage_txn_id"); got != "txn_org_overage_1" {
		t.Errorf("paddle_overage_txn_id = %q, want txn_org_overage_1", got)
	}
}

func TestOrgPaddleWebhookPooledNoOverage(t *testing.T) {
	fake := &fakePaddleClient{}
	app, mux, orgID := activateOrgPAYGWithClient(t, fake)

	// 3 seats = floor 4500; seed 3000 rappen → no overage.
	ob := orgBillingFor(t, app, orgID)
	ob.Set("seat_quantity", 3)
	if err := app.Save(ob); err != nil {
		t.Fatalf("set seat_quantity: %v", err)
	}

	seedOrgUsage(t, app, orgID, time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC), 3000)

	rollover := orgRolloverFor(orgID, 3)
	if rec := postWebhook(mux, rollover, signPaddle(t, webhookSecret, rollover)); rec.Code != http.StatusOK {
		t.Fatalf("rollover status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	if fake.chargeCalls != 0 {
		t.Errorf("CreateOneTimeCharge calls = %d, want 0", fake.chargeCalls)
	}

	summary := orgCycleSummaryFor(t, app, "sub_org_1")
	if summary == nil {
		t.Fatal("expected an org_cycle_summaries row")
	}
	if got := summary.GetInt("overage_charge_rappen"); got != 0 {
		t.Errorf("overage_charge_rappen = %d, want 0", got)
	}
	if got := summary.GetString("paddle_overage_txn_id"); got != "" {
		t.Errorf("paddle_overage_txn_id = %q, want empty", got)
	}
}

func TestOrgPaddleWebhookSeatRemoveNextCycle(t *testing.T) {
	app, mux, orgID := activateOrgPAYG(t)

	// Current cycle has 3 seats; one member offboarded so pending = 2.
	ob := orgBillingFor(t, app, orgID)
	ob.Set("seat_quantity", 3)
	ob.Set("pending_seat_quantity", 2)
	if err := app.Save(ob); err != nil {
		t.Fatalf("set seat quantities: %v", err)
	}

	// Seed usage of 5000 rappen. Floor with OLD qty = 3*1500 = 4500 → overage 500.
	seedOrgUsage(t, app, orgID, time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC), 5000)

	rollover := orgRolloverFor(orgID, 3) // qty in items reflects current subscription
	if rec := postWebhook(mux, rollover, signPaddle(t, webhookSecret, rollover)); rec.Code != http.StatusOK {
		t.Fatalf("rollover status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	// Cycle close should use old seat_quantity = 3.
	summary := orgCycleSummaryFor(t, app, "sub_org_1")
	if got := summary.GetInt("seat_quantity"); got != 3 {
		t.Errorf("closed cycle seat_quantity = %d, want 3", got)
	}
	if got := summary.GetInt("overage_charge_rappen"); got != 500 {
		t.Errorf("overage_charge_rappen = %d, want 500", got)
	}

	// After rollover, the live seat_quantity drops to pending value.
	ob = orgBillingFor(t, app, orgID)
	if got := ob.GetInt("seat_quantity"); got != 2 {
		t.Errorf("new seat_quantity = %d, want 2", got)
	}
	if ob.GetInt("pending_seat_quantity") != 0 {
		t.Error("pending_seat_quantity should be cleared after rollover")
	}
}

func TestOrgPaddleWebhookPastDueLapsesOrg(t *testing.T) {
	app, mux, orgID := activateOrgPAYG(t)

	body := `{"event_id":"evt_org_past_due","event_type":"subscription.past_due",` +
		`"data":{"id":"sub_org_1","customer_id":"ctm_org_1","status":"past_due",` +
		`"custom_data":{"org_id":"` + orgID + `"}}}`

	if rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body)); rec.Code != http.StatusOK {
		t.Fatalf("past_due status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	ob := orgBillingFor(t, app, orgID)
	if !ob.GetBool("past_due") {
		t.Error("past_due should be true")
	}
	if got := ob.GetString("plan_type"); got != "payg" {
		t.Errorf("plan_type = %q, want payg (access continues during dunning)", got)
	}
}

func TestOrgPaddleWebhookCancelLapsesOrg(t *testing.T) {
	app, mux, orgID := activateOrgPAYG(t)

	body := `{"event_id":"evt_org_cancel","event_type":"subscription.canceled",` +
		`"data":{"id":"sub_org_1","customer_id":"ctm_org_1","status":"canceled",` +
		`"custom_data":{"org_id":"` + orgID + `"}}}`

	if rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body)); rec.Code != http.StatusOK {
		t.Fatalf("cancel status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	ob := orgBillingFor(t, app, orgID)
	if got := ob.GetString("plan_type"); got != "inactive" {
		t.Errorf("plan_type = %q, want inactive", got)
	}
	if got := ob.GetString("paddle_subscription_id"); got != "" {
		t.Errorf("paddle_subscription_id = %q, want empty", got)
	}
}

func TestOrgPaddleWebhookReactivationClearsPastDue(t *testing.T) {
	app, mux, orgID := activateOrgPAYG(t)

	// Put org into past_due.
	pastDue := `{"event_id":"evt_org_past_due","event_type":"subscription.past_due",` +
		`"data":{"id":"sub_org_1","customer_id":"ctm_org_1","status":"past_due",` +
		`"custom_data":{"org_id":"` + orgID + `"}}}`
	postWebhook(mux, pastDue, signPaddle(t, webhookSecret, pastDue))

	recoverBody := `{"event_id":"evt_org_recover","event_type":"subscription.activated",` +
		`"data":{"id":"sub_org_1","customer_id":"ctm_org_1","status":"active",` +
		`"custom_data":{"org_id":"` + orgID + `"},` +
		`"items":[{"price":{"id":"pri_payg"},"quantity":1}],` +
		`"current_billing_period":{"starts_at":"2026-07-01T00:00:00Z","ends_at":"2026-08-01T00:00:00Z"}}}`

	if rec := postWebhook(mux, recoverBody, signPaddle(t, webhookSecret, recoverBody)); rec.Code != http.StatusOK {
		t.Fatalf("recover status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	ob := orgBillingFor(t, app, orgID)
	if ob.GetBool("past_due") {
		t.Error("past_due should be cleared after recovery")
	}
	if got := ob.GetString("plan_type"); got != "payg" {
		t.Errorf("plan_type = %q, want payg", got)
	}
}

func TestOrgPaddleWebhookAdjustmentMapsToOrg(t *testing.T) {
	app, mux, orgID := activateOrgPAYG(t)

	body := `{"event_id":"evt_org_adj","event_type":"adjustment.created",` +
		`"data":{"id":"adj_org_1","action":"refund","transaction_id":"txn_inv_org_1",` +
		`"subscription_id":"sub_org_1","customer_id":"ctm_org_1","reason":"changed mind",` +
		`"totals":{"total":"5000","currency_code":"CHF"}}}`

	if rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body)); rec.Code != http.StatusOK {
		t.Fatalf("adjustment status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	// The refund row should reference the organisation.
	refunds, err := app.FindRecordsByFilter("refunds", "organisation = {:o}", "", 10, 0, map[string]any{"o": orgID})
	if err != nil {
		t.Fatalf("find refunds: %v", err)
	}
	if len(refunds) != 1 {
		t.Fatalf("refunds count = %d, want 1", len(refunds))
	}
	r := refunds[0]
	if got := r.GetInt("gross_refund_rappen"); got != 5000 {
		t.Errorf("gross_refund_rappen = %d, want 5000", got)
	}
}

func TestOrgPaddleWebhookOrgChargebackDeactivates(t *testing.T) {
	app, mux, orgID := activateOrgPAYG(t)

	body := `{"event_id":"evt_org_cb","event_type":"adjustment.created",` +
		`"data":{"id":"adj_org_cb","action":"chargeback","transaction_id":"txn_inv_org_2",` +
		`"subscription_id":"sub_org_1","customer_id":"ctm_org_1",` +
		`"totals":{"total":"5000","currency_code":"CHF"}}}`

	if rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body)); rec.Code != http.StatusOK {
		t.Fatalf("chargeback status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	ob := orgBillingFor(t, app, orgID)
	if got := ob.GetString("plan_type"); got != "inactive" {
		t.Errorf("plan_type = %q, want inactive after chargeback", got)
	}
}

func TestOrgPaddleWebhookTransactionCompletedReconcilesOrgCycle(t *testing.T) {
	app, mux, orgID := activateOrgPAYG(t)

	// Roll over to create a summary.
	seedOrgUsage(t, app, orgID, time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC), 1500)
	rollover := orgRolloverFor(orgID, 1)
	postWebhook(mux, rollover, signPaddle(t, webhookSecret, rollover))

	summary := orgCycleSummaryFor(t, app, "sub_org_1")
	if summary == nil {
		t.Fatal("setup: expected an org cycle summary after rollover")
	}

	txnBody := `{"event_id":"evt_org_txn","event_type":"transaction.completed",` +
		`"data":{"id":"txn_org_cycle_1","subscription_id":"sub_org_1","status":"completed",` +
		`"details":{"totals":{"grand_total":"1500"}}}}`
	if rec := postWebhook(mux, txnBody, signPaddle(t, webhookSecret, txnBody)); rec.Code != http.StatusOK {
		t.Fatalf("transaction.completed status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	summary = orgCycleSummaryFor(t, app, "sub_org_1")
	if got := summary.GetString("paddle_transaction_id"); got != "txn_org_cycle_1" {
		t.Errorf("paddle_transaction_id = %q, want txn_org_cycle_1", got)
	}
	if got := summary.GetInt("paddle_billed_rappen"); got != 1500 {
		t.Errorf("paddle_billed_rappen = %d, want 1500", got)
	}
	if !summary.GetBool("reconciled") {
		t.Error("reconciled should be true")
	}
}

func TestOrgPaddleWebhookIdempotentOnOrgEvent(t *testing.T) {
	app, mux, orgID := activateOrgPAYG(t)

	body := `{"event_id":"evt_org_dup","event_type":"subscription.created",` +
		`"data":{"id":"sub_org_1","customer_id":"ctm_org_1","status":"active",` +
		`"custom_data":{"org_id":"` + orgID + `"},` +
		`"items":[{"price":{"id":"pri_payg"},"quantity":1}],` +
		`"current_billing_period":{"starts_at":"2026-06-01T00:00:00Z","ends_at":"2026-07-01T00:00:00Z"}}}`

	sig := signPaddle(t, webhookSecret, body)
	first := postWebhook(mux, body, sig)
	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d, want 200", first.Code)
	}

	second := postWebhook(mux, body, sig)
	if second.Code != http.StatusOK {
		t.Fatalf("second status = %d, want 200", second.Code)
	}
	if !strings.Contains(second.Body.String(), "duplicate") {
		t.Errorf("re-delivery should be duplicate, got: %s", second.Body.String())
	}

	n, _ := app.CountRecords("org_billing")
	if n != 1 {
		t.Errorf("org_billing count = %d, want 1", n)
	}
}

func TestOrgPaddleWebhookUnknownOrgIgnored(t *testing.T) {
	app, mux := bootWebhookMux(t)

	body := `{"event_id":"evt_org_unknown","event_type":"subscription.created",` +
		`"data":{"id":"sub_org_x","customer_id":"ctm_org_x","status":"active",` +
		`"custom_data":{"org_id":"nonexistent_record_id_12345"},` +
		`"items":[{"price":{"id":"pri_payg"},"quantity":1}]}}`

	rec := postWebhook(mux, body, signPaddle(t, webhookSecret, body))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — body: %s", rec.Code, rec.Body.String())
	}

	n, _ := app.CountRecords("paddle_events")
	if n != 1 {
		t.Errorf("paddle_events count = %d, want 1", n)
	}

	// No org_billing row created.
	records, _ := app.FindRecordsByFilter("org_billing", "paddle_subscription_id = {:s}", "", 10, 0, map[string]any{"s": "sub_org_x"})
	if len(records) != 0 {
		t.Errorf("unexpected org_billing rows for unknown org: %d", len(records))
	}
}
