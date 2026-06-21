package main

import (
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/pocketbase/pocketbase/core"
)

func TestPocketBaseBillingRepoEnsureTrialStateCreatesDefaultTrialRecord(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	repo := billing.NewPocketBaseRepo(app)
	if err := repo.EnsureTrialState("j8prcx3dum2l3kc", billing.DefaultTrialSeedRappen); err != nil {
		t.Fatalf("EnsureTrialState() error = %v", err)
	}

	record, err := app.FindFirstRecordByData("user_billing", "user_id", "j8prcx3dum2l3kc")
	if err != nil {
		t.Fatalf("FindFirstRecordByData(user_billing) error = %v", err)
	}
	if got := record.GetString("plan_type"); got != string(billing.PlanTypeTrial) {
		t.Errorf("user_billing.plan_type = %q, want %q", got, billing.PlanTypeTrial)
	}
	if got := record.GetInt("balance_rappen"); got != int(billing.DefaultTrialSeedRappen) {
		t.Errorf("user_billing.balance_rappen = %d, want %d", got, billing.DefaultTrialSeedRappen)
	}
	if got := record.GetInt("trial_seed_granted_rappen"); got != int(billing.DefaultTrialSeedRappen) {
		t.Errorf("user_billing.trial_seed_granted_rappen = %d, want %d", got, billing.DefaultTrialSeedRappen)
	}
	if got := record.GetDateTime("plan_started_at"); got.IsZero() {
		t.Fatal("user_billing.plan_started_at unexpectedly zero")
	}
}

func TestPocketBaseBillingRepoEnsureTrialStateIsIdempotent(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	repo := billing.NewPocketBaseRepo(app)
	if err := repo.EnsureTrialState("j8prcx3dum2l3kc", billing.DefaultTrialSeedRappen); err != nil {
		t.Fatalf("EnsureTrialState(first) error = %v", err)
	}
	if err := repo.EnsureTrialState("j8prcx3dum2l3kc", 999); err != nil {
		t.Fatalf("EnsureTrialState(second) error = %v", err)
	}

	records, err := app.FindRecordsByFilter("user_billing", "user_id = {:user_id}", "", 10, 0, map[string]any{"user_id": "j8prcx3dum2l3kc"})
	if err != nil {
		t.Fatalf("FindRecordsByFilter(user_billing) error = %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("FindRecordsByFilter(user_billing) len = %d, want %d", len(records), 1)
	}
	if got := records[0].GetInt("balance_rappen"); got != int(billing.DefaultTrialSeedRappen) {
		t.Errorf("user_billing.balance_rappen = %d, want %d", got, billing.DefaultTrialSeedRappen)
	}
}

func TestNewUsersReceiveTrialBillingStateOnCreate(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	usersCollection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(users) error = %v", err)
	}

	record := core.NewRecord(usersCollection)
	record.Id = "newtrialuser001"
	record.Set("email", "newtrial@example.com")
	record.Set("username", "newtrial")
	record.Set("verified", true)
	record.Set("privacy_tier", "eu")
	record.SetPassword("password-1234")
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(users) error = %v", err)
	}

	billingRecord, err := app.FindFirstRecordByData("user_billing", "user_id", record.Id)
	if err != nil {
		t.Fatalf("FindFirstRecordByData(user_billing) error = %v", err)
	}
	if got := billingRecord.GetString("plan_type"); got != string(billing.PlanTypeTrial) {
		t.Errorf("user_billing.plan_type = %q, want %q", got, billing.PlanTypeTrial)
	}
	if got := billingRecord.GetInt("balance_rappen"); got != int(billing.DefaultTrialSeedRappen) {
		t.Errorf("user_billing.balance_rappen = %d, want %d", got, billing.DefaultTrialSeedRappen)
	}
}

func TestNewUsersReceiveConfiguredTrialBillingStateOnCreate(t *testing.T) {
	t.Parallel()

	app := setupTestAppWithHookParams(t, appHookParams{
		Config: &config.APIConfig{
			InfomaniakAPIKey:       "test-infomaniak-key",
			InfomaniakProductID:    "test-product-id",
			RequestyAPIKey:         "test-requesty-key",
			BillingTrialSeedRappen: 321,
		},
	})
	defer app.Cleanup()

	usersCollection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(users) error = %v", err)
	}

	record := core.NewRecord(usersCollection)
	record.Id = "newtrialuser002"
	record.Set("email", "newtrial-config@example.com")
	record.Set("username", "newtrial-config")
	record.Set("verified", true)
	record.Set("privacy_tier", "eu")
	record.SetPassword("password-1234")
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(users) error = %v", err)
	}

	billingRecord, err := app.FindFirstRecordByData("user_billing", "user_id", record.Id)
	if err != nil {
		t.Fatalf("FindFirstRecordByData(user_billing) error = %v", err)
	}
	if got := billingRecord.GetInt("balance_rappen"); got != 321 {
		t.Errorf("user_billing.balance_rappen = %d, want %d", got, 321)
	}
	if got := billingRecord.GetInt("trial_seed_granted_rappen"); got != 321 {
		t.Errorf("user_billing.trial_seed_granted_rappen = %d, want %d", got, 321)
	}
}

func TestSeedUsersHaveTrialBillingState(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	for _, user := range testUsers {
		record, err := app.FindFirstRecordByData("user_billing", "user_id", user.ID)
		if err != nil {
			t.Fatalf("FindFirstRecordByData(user_billing, %q) error = %v", user.ID, err)
		}
		if got := record.GetString("plan_type"); got != string(billing.PlanTypeTrial) {
			t.Fatalf("user %q plan_type = %q, want %q", user.ID, got, billing.PlanTypeTrial)
		}
		if got := record.GetInt("balance_rappen"); got != int(billing.DefaultTrialSeedRappen) {
			t.Fatalf("user %q balance_rappen = %d, want %d", user.ID, got, billing.DefaultTrialSeedRappen)
		}
		if got := record.GetDateTime("plan_started_at"); got.IsZero() {
			t.Fatalf("user %q plan_started_at unexpectedly zero", user.ID)
		}
	}
}
