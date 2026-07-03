package main

import (
	"context"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
)

// seedCycleSummary inserts a payg_cycle_summaries row for the test user.
func seedCycleSummary(t testing.TB, app *tests.TestApp, id string, fields map[string]any) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("payg_cycle_summaries")
	if err != nil {
		t.Fatalf("find payg_cycle_summaries: %v", err)
	}
	record := core.NewRecord(collection)
	record.Id = id
	record.Set("user_id", testUserID)
	for k, v := range fields {
		record.Set(k, v)
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("seed cycle summary %q: %v", id, err)
	}
}

// seedRefund inserts a refunds row for the test user with the given
// paddle_adjustment_ids_json payload.
func seedRefund(t testing.TB, app *tests.TestApp, id, adjustmentJSON string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("refunds")
	if err != nil {
		t.Fatalf("find refunds: %v", err)
	}
	record := core.NewRecord(collection)
	record.Id = id
	record.Set("user_id", testUserID)
	record.Set("paddle_adjustment_ids_json", adjustmentJSON)
	if err := app.Save(record); err != nil {
		t.Fatalf("seed refund %q: %v", id, err)
	}
}

func TestRetryUnpostedOveragesReposts(t *testing.T) {
	app := setupBillingApp(t, nil)
	repo := billing.NewPocketBaseRepo(app)

	// A closed cycle with an overage that never got a txn id (charge failed).
	seedCycleSummary(t, app, "cyclesumm000001", map[string]any{
		"paddle_subscription_id":     "sub_payg",
		"overage_charge_rappen":      840,
		"local_expected_bill_rappen": 2340,
		"paddle_overage_txn_id":      "",
		"reconciled":                 false,
	})
	// One already posted — must be skipped.
	seedCycleSummary(t, app, "cyclesumm000002", map[string]any{
		"paddle_subscription_id": "sub_payg",
		"overage_charge_rappen":  500,
		"paddle_overage_txn_id":  "txn_already",
	})
	// One within commit (no overage) — must be skipped.
	seedCycleSummary(t, app, "cyclesumm000003", map[string]any{
		"paddle_subscription_id": "sub_payg",
		"overage_charge_rappen":  0,
		"paddle_overage_txn_id":  "",
	})

	fake := &fakePaddleClient{chargeTxnID: "txn_recovered"}
	posted, err := repo.RetryUnpostedOverages(context.Background(), fake, "pri_overage", nil)
	if err != nil {
		t.Fatalf("RetryUnpostedOverages: %v", err)
	}
	if posted != 1 {
		t.Fatalf("posted = %d, want 1 (only the unposted overage)", posted)
	}
	if fake.chargeCalls != 1 {
		t.Errorf("charge calls = %d, want 1", fake.chargeCalls)
	}
	if fake.chargeQuantity != 840 {
		t.Errorf("charge quantity = %d, want 840", fake.chargeQuantity)
	}
	if fake.chargeIdemKey != "overage_cyclesumm000001" {
		t.Errorf("idempotency key = %q, want overage_cyclesumm000001", fake.chargeIdemKey)
	}

	record, err := app.FindRecordById("payg_cycle_summaries", "cyclesumm000001")
	if err != nil {
		t.Fatalf("find summary: %v", err)
	}
	if got := record.GetString("paddle_overage_txn_id"); got != "txn_recovered" {
		t.Errorf("paddle_overage_txn_id = %q, want txn_recovered", got)
	}
}

// A second backstop pass after success re-posts nothing (idempotent).
func TestRetryUnpostedOveragesIsIdempotent(t *testing.T) {
	app := setupBillingApp(t, nil)
	repo := billing.NewPocketBaseRepo(app)
	seedCycleSummary(t, app, "cyclesumm000010", map[string]any{
		"paddle_subscription_id": "sub_payg",
		"overage_charge_rappen":  900,
		"paddle_overage_txn_id":  "",
	})

	fake := &fakePaddleClient{chargeTxnID: "txn_a"}
	if _, err := repo.RetryUnpostedOverages(context.Background(), fake, "pri_overage", nil); err != nil {
		t.Fatalf("first pass: %v", err)
	}
	if _, err := repo.RetryUnpostedOverages(context.Background(), fake, "pri_overage", nil); err != nil {
		t.Fatalf("second pass: %v", err)
	}
	if fake.chargeCalls != 1 {
		t.Errorf("charge calls = %d, want 1 (second pass finds nothing unposted)", fake.chargeCalls)
	}
}
