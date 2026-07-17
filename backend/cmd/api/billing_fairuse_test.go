package main

import (
	"fmt"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
)

// seedPlanUsage inserts a `usage` ledger row with an explicit plan_type +
// occurred_at, for the fair-use rollup (which filters on both).
func seedPlanUsage(
	t testing.TB, app *tests.TestApp, id, userID, planType string, costRappen int64, occurredAt time.Time,
) {
	seedModelPlanUsage(t, app, id, userID, "m", planType, costRappen, costRappen, occurredAt)
}

func seedModelPlanUsage(
	t testing.TB,
	app *tests.TestApp,
	id, userID, modelID, planType string,
	providerCostRappen, userCostRappen int64,
	occurredAt time.Time,
) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("balance_transactions")
	if err != nil {
		t.Fatalf("find balance_transactions: %v", err)
	}
	record := core.NewRecord(collection)
	record.Id = id
	record.Set("user_id", userID)
	record.Set("event_id", "evt_"+id)
	record.Set("type", "usage")
	record.Set("plan_type", planType)
	record.Set("model_id", modelID)
	record.Set("amount_rappen", 0)
	record.Set("provider_cost_rappen", providerCostRappen)
	record.Set("provider_cost_microrappen", providerCostRappen*billing.MicroRappenPerRappen)
	record.Set("user_cost_rappen", userCostRappen)
	record.Set("user_cost_microrappen", userCostRappen*billing.MicroRappenPerRappen)
	record.Set("occurred_at", occurredAt.UTC())
	if err := app.Save(record); err != nil {
		t.Fatalf("seed usage %q: %v", id, err)
	}
}

func TestCostRiskSince(t *testing.T) {
	app := setupBillingApp(t, nil)
	repo := billing.NewPocketBaseRepo(app)

	otherUser, err := app.FindFirstRecordByData("users", "email", "test2@example.com")
	if err != nil {
		t.Fatalf("find test2 user: %v", err)
	}
	now := time.Now().UTC()
	seedModelPlanUsage(t, app, "costrisk0000001", testUserID, "model-fast", "payg", 1000, 1220, now.Add(-time.Hour))
	seedModelPlanUsage(t, app, "costrisk0000002", otherUser.Id, "model-deep", "unlimited", 3000, 3660, now.Add(-time.Hour))
	seedModelPlanUsage(t, app, "costrisk0000003", testUserID, "model-old", "payg", 9000, 10980, now.Add(-40*24*time.Hour))

	report, err := repo.CostRiskSince(now.Add(-billing.DefaultFairUseWindow))
	if err != nil {
		t.Fatalf("CostRiskSince: %v", err)
	}
	if report.AccountProviderCost.P50Rappen != 1000 || report.AccountProviderCost.P95Rappen != 3000 {
		t.Errorf("account percentiles = %+v, want p50=1000 p95=3000", report.AccountProviderCost)
	}
	if len(report.Models) != 2 {
		t.Fatalf("models = %d (%+v), want two in-window Models", len(report.Models), report.Models)
	}
	if report.Models[0].ModelID != "model-deep" || report.Models[1].ModelID != "model-fast" {
		t.Fatalf("model order = %q, %q, want model-deep, model-fast", report.Models[0].ModelID, report.Models[1].ModelID)
	}
	if got := report.Models[1].PAYGGrossMarginBPS; got != 1803 {
		t.Errorf("model-fast PAYG gross margin = %d bps, want 1803", got)
	}
}

func TestFlagFairUseOutliers(t *testing.T) {
	app := setupBillingApp(t, nil)
	repo := billing.NewPocketBaseRepo(app)

	otherUser, err := app.FindFirstRecordByData("users", "email", "test2@example.com")
	if err != nil {
		t.Fatalf("find test2 user: %v", err)
	}
	now := time.Now().UTC()
	recent := now.Add(-5 * 24 * time.Hour)
	old := now.Add(-40 * 24 * time.Hour)

	// Heavy Unlimited user: CHF 250 across two rows in-window → over CHF 200.
	seedPlanUsage(t, app, "fairuse00000001", testUserID, "unlimited", 15000, recent)
	seedPlanUsage(t, app, "fairuse00000002", testUserID, "unlimited", 10000, recent)
	// PAYG usage for the same user must NOT count (plan filter).
	seedPlanUsage(t, app, "fairuse00000003", testUserID, "payg", 99999, recent)
	// Old Unlimited usage must NOT count (outside the 30-day window).
	seedPlanUsage(t, app, "fairuse00000004", testUserID, "unlimited", 99999, old)
	// A normal Unlimited user well under the threshold.
	seedPlanUsage(t, app, "fairuse00000005", otherUser.Id, "unlimited", 5000, recent)

	since := now.Add(-billing.DefaultFairUseWindow)
	flags, err := repo.FlagFairUseOutliers(since, billing.DefaultFairUseAlertRappen)
	if err != nil {
		t.Fatalf("FlagFairUseOutliers: %v", err)
	}

	if len(flags) != 1 {
		t.Fatalf("flags = %d (%v), want 1 (only the heavy user)", len(flags), flags)
	}
	if flags[0].UserID != testUserID {
		t.Errorf("flagged user = %q, want %q", flags[0].UserID, testUserID)
	}
	// CHF 250 = 25000 rappen — PAYG + out-of-window rows excluded.
	if flags[0].RollingCostRappen != 25000 {
		t.Errorf("rolling cost = %d, want 25000", flags[0].RollingCostRappen)
	}
	if flags[0].RequestCount != 2 {
		t.Errorf("request count = %d, want 2", flags[0].RequestCount)
	}
}

// A threshold above everyone's usage flags nobody (the job never fires on
// normal accounts).
func TestFlagFairUseOutliersNoneUnderThreshold(t *testing.T) {
	app := setupBillingApp(t, nil)
	repo := billing.NewPocketBaseRepo(app)
	now := time.Now().UTC()

	for i := 0; i < 3; i++ {
		seedPlanUsage(t, app, fmt.Sprintf("fairuselow%05d", i), testUserID, "unlimited", 3000, now.Add(-time.Hour))
	}

	flags, err := repo.FlagFairUseOutliers(now.Add(-billing.DefaultFairUseWindow), billing.DefaultFairUseAlertRappen)
	if err != nil {
		t.Fatalf("FlagFairUseOutliers: %v", err)
	}
	if len(flags) != 0 {
		t.Errorf("flags = %d, want 0 (CHF 90 is under the CHF 200 threshold)", len(flags))
	}
}

func TestFlagFairUseOutliersIncludesExactThreshold(t *testing.T) {
	app := setupBillingApp(t, nil)
	repo := billing.NewPocketBaseRepo(app)
	now := time.Now().UTC()
	seedPlanUsage(t, app, "fairuseexact001", testUserID, "unlimited", billing.DefaultFairUseAlertRappen, now.Add(-time.Hour))

	flags, err := repo.FlagFairUseOutliers(now.Add(-billing.DefaultFairUseWindow), billing.DefaultFairUseAlertRappen)
	if err != nil {
		t.Fatalf("FlagFairUseOutliers: %v", err)
	}
	if len(flags) != 1 || flags[0].RollingCostRappen != billing.DefaultFairUseAlertRappen {
		t.Fatalf("flags = %+v, want exact-threshold Account", flags)
	}
}
