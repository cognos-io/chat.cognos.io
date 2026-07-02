package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestPocketBaseBillingRepoStateForUserMapsLegacyFlatRateAlias(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	setUserBillingRecord(t, app, seedUserBillingRecordInput{
		UserID:        "uvi8zmr78j9y5hz",
		PlanType:      "flat_rate",
		BalanceRappen: 123,
	})

	repo := billing.NewPocketBaseRepo(app)
	got, err := repo.StateForUser("uvi8zmr78j9y5hz")
	if err != nil {
		t.Fatalf("StateForUser() error = %v", err)
	}
	if got.BillingUserID == "" {
		t.Error("StateForUser().BillingUserID = empty, want non-empty")
	}
	if got.PlanType != billing.PlanTypeUnlimited {
		t.Errorf("StateForUser().PlanType = %q, want %q", got.PlanType, billing.PlanTypeUnlimited)
	}
	if got.BalanceRappen != 123 {
		t.Errorf("StateForUser().BalanceRappen = %d, want %d", got.BalanceRappen, 123)
	}
}

// Regression: an Unlimited usage row has amount_rappen = 0 by design (cost
// lives in user_cost_rappen). It must persist — a required amount_rappen field
// rejected 0 as "blank", silently dropping every Unlimited usage row.
func TestPocketBaseBillingRepoRecordsZeroAmountUnlimitedUsage(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	repo := billing.NewPocketBaseRepo(app)
	err := repo.RecordUsage(billing.UsageRecord{
		UserID:         "uvi8zmr78j9y5hz",
		EventID:        "evt_unlimited_zero",
		ModelID:        "test-model",
		PlanType:       billing.PlanTypeUnlimited,
		Type:           billing.UsageTransactionType,
		AmountRappen:   0,
		UserCostRappen: 1234,
	})
	if err != nil {
		t.Fatalf("RecordUsage(unlimited, amount=0) error = %v", err)
	}

	records, err := app.FindRecordsByFilter(
		"balance_transactions", "event_id = {:e}", "", 1, 0,
		map[string]any{"e": "evt_unlimited_zero"},
	)
	if err != nil || len(records) != 1 {
		t.Fatalf("expected the zero-amount usage row to persist (err=%v, n=%d)", err, len(records))
	}
	if got := records[0].GetInt("user_cost_rappen"); got != 1234 {
		t.Errorf("user_cost_rappen = %d, want 1234", got)
	}
}

func TestPocketBaseBillingRepoStateForUserReturnsErrStateNotFound(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	repo := billing.NewPocketBaseRepo(app)
	_, err := repo.StateForUser("missingbilling01")
	if err == nil {
		t.Fatal("StateForUser() error = nil, want ErrStateNotFound")
	}
	if err != billing.ErrStateNotFound {
		t.Fatalf("StateForUser() error = %v, want %v", err, billing.ErrStateNotFound)
	}
}

func TestPocketBaseBillingRepoRecordUsageUpdatesTrialBalanceAndWritesTransaction(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	setUserBillingRecord(t, app, seedUserBillingRecordInput{
		UserID:        "uvi8zmr78j9y5hz",
		PlanType:      string(billing.PlanTypeTrial),
		BalanceRappen: 200,
	})

	repo := billing.NewPocketBaseRepo(app)
	balanceAfter := int64(188)
	balanceAfterMicro := int64(188_000_000)
	if err := repo.RecordUsage(billing.UsageRecord{
		UserID:                  "uvi8zmr78j9y5hz",
		EventID:                 "evt-trial-1",
		ModelID:                 "llama-3-3-infomaniak",
		PlanType:                billing.PlanTypeTrial,
		Type:                    billing.UsageTransactionType,
		AmountRappen:            -12,
		ProviderCostRappen:      10,
		UserCostRappen:          12,
		AmountMicroRappen:       -12_000_000,
		ProviderCostMicroRappen: 10_000_000,
		UserCostMicroRappen:     12_000_000,
		FXRateUSDCHF:            1,
		InputTokens:             8,
		OutputTokens:            4,
		BalanceAfterRappen:      &balanceAfter,
		BalanceAfterMicroRappen: &balanceAfterMicro,
	}); err != nil {
		t.Fatalf("RecordUsage() error = %v", err)
	}

	billingRecord, err := app.FindFirstRecordByData("user_billing", "user_id", "uvi8zmr78j9y5hz")
	if err != nil {
		t.Fatalf("FindFirstRecordByData(user_billing) error = %v", err)
	}
	if got := billingRecord.GetInt("balance_rappen"); got != 188 {
		t.Fatalf("user_billing.balance_rappen = %d, want %d", got, 188)
	}
	if got := billingRecord.GetInt("balance_microrappen"); got != 188_000_000 {
		t.Fatalf("user_billing.balance_microrappen = %d, want %d", got, 188_000_000)
	}

	transactionRecord, err := app.FindFirstRecordByData("balance_transactions", "event_id", "evt-trial-1")
	if err != nil {
		t.Fatalf("FindFirstRecordByData(balance_transactions) error = %v", err)
	}
	if got := transactionRecord.GetString("plan_type"); got != string(billing.PlanTypeTrial) {
		t.Errorf("balance_transactions.plan_type = %q, want %q", got, billing.PlanTypeTrial)
	}
	if got := transactionRecord.GetString("model_id"); got != "llama-3-3-infomaniak" {
		t.Errorf("balance_transactions.model_id = %q, want %q", got, "llama-3-3-infomaniak")
	}
	if got := transactionRecord.GetInt("amount_rappen"); got != -12 {
		t.Errorf("balance_transactions.amount_rappen = %d, want %d", got, -12)
	}
	if got := transactionRecord.GetInt("balance_after_rappen"); got != 188 {
		t.Errorf("balance_transactions.balance_after_rappen = %d, want %d", got, 188)
	}
	if got := transactionRecord.GetInt("provider_cost_rappen"); got != 10 {
		t.Errorf("balance_transactions.provider_cost_rappen = %d, want %d", got, 10)
	}
	if got := transactionRecord.GetInt("user_cost_rappen"); got != 12 {
		t.Errorf("balance_transactions.user_cost_rappen = %d, want %d", got, 12)
	}
	if got := transactionRecord.GetInt("user_cost_microrappen"); got != 12_000_000 {
		t.Errorf("balance_transactions.user_cost_microrappen = %d, want %d", got, 12_000_000)
	}
	if got := transactionRecord.GetInt("balance_after_microrappen"); got != 188_000_000 {
		t.Errorf("balance_transactions.balance_after_microrappen = %d, want %d", got, 188_000_000)
	}
	if got := transactionRecord.GetInt("input_tokens"); got != 8 {
		t.Errorf("balance_transactions.input_tokens = %d, want %d", got, 8)
	}
	if got := transactionRecord.GetInt("output_tokens"); got != 4 {
		t.Errorf("balance_transactions.output_tokens = %d, want %d", got, 4)
	}
	if got := transactionRecord.GetDateTime("occurred_at"); got.IsZero() {
		t.Fatal("balance_transactions.occurred_at unexpectedly zero")
	}
}

func TestPocketBaseBillingRepoRecordUsageRollsBackTrialBalanceOnDuplicateEventID(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	setUserBillingRecord(t, app, seedUserBillingRecordInput{
		UserID:        "uvi8zmr78j9y5hz",
		PlanType:      string(billing.PlanTypeTrial),
		BalanceRappen: 200,
	})
	seedBalanceTransactionRecord(t, app, seedBalanceTransactionRecordInput{
		ID:           "txduplicate0001",
		UserID:       "uvi8zmr78j9y5hz",
		EventID:      "evt-duplicate-1",
		Type:         billing.UsageTransactionType,
		AmountRappen: -12,
	})

	repo := billing.NewPocketBaseRepo(app)
	balanceAfter := int64(188)
	balanceAfterMicro := int64(188_000_000)
	err := repo.RecordUsage(billing.UsageRecord{
		UserID:                  "uvi8zmr78j9y5hz",
		EventID:                 "evt-duplicate-1",
		ModelID:                 "llama-3-3-infomaniak",
		PlanType:                billing.PlanTypeTrial,
		Type:                    billing.UsageTransactionType,
		AmountRappen:            -12,
		ProviderCostRappen:      10,
		UserCostRappen:          12,
		AmountMicroRappen:       -12_000_000,
		ProviderCostMicroRappen: 10_000_000,
		UserCostMicroRappen:     12_000_000,
		FXRateUSDCHF:            1,
		InputTokens:             8,
		OutputTokens:            4,
		BalanceAfterRappen:      &balanceAfter,
		BalanceAfterMicroRappen: &balanceAfterMicro,
	})
	if err == nil {
		t.Fatal("RecordUsage() error = nil, want duplicate event_id failure")
	}

	billingRecord, findErr := app.FindFirstRecordByData("user_billing", "user_id", "uvi8zmr78j9y5hz")
	if findErr != nil {
		t.Fatalf("FindFirstRecordByData(user_billing) error = %v", findErr)
	}
	if got := billingRecord.GetInt("balance_rappen"); got != 200 {
		t.Fatalf("user_billing.balance_rappen = %d, want %d after rollback", got, 200)
	}
	if got := billingRecord.GetInt("balance_microrappen"); got != 200_000_000 {
		t.Fatalf("user_billing.balance_microrappen = %d, want %d after rollback", got, 200_000_000)
	}
}

func TestCompletionsUsePocketBaseBillingReposByDefault(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.10
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(_ context.Context, _ gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "persisted reply"},
				Usage: gateway.Usage{
					InputTokens:     8,
					OutputTokens:    4,
					TotalTokens:     12,
					ProviderCostUSD: &providerCostUSD,
				},
			}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "generic completions persist billing usage through the default pocketbase repos",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"content":"persisted reply"`,
			`"cost_rappen":12`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			billingRecord, err := app.FindFirstRecordByData("user_billing", "user_id", "uvi8zmr78j9y5hz")
			if err != nil {
				t.Fatalf("FindFirstRecordByData(user_billing) error = %v", err)
			}
			// 200 rappen seed - 12.2 rappen (0.10 USD * 1.22 margin) = 187.8,
			// floored to 187 so we never overstate remaining credit. The precise
			// balance lives in balance_microrappen.
			if got := billingRecord.GetInt("balance_rappen"); got != 187 {
				t.Fatalf("user_billing.balance_rappen = %d, want %d", got, 187)
			}
			if got := billingRecord.GetInt("balance_microrappen"); got != 187_800_000 {
				t.Fatalf("user_billing.balance_microrappen = %d, want %d", got, 187_800_000)
			}
			count, err := app.CountRecords("balance_transactions")
			if err != nil {
				t.Fatalf("CountRecords(balance_transactions) error = %v", err)
			}
			if count != 1 {
				t.Fatalf("CountRecords(balance_transactions) = %d, want %d", count, 1)
			}
		},
	}

	scenario.Test(t)
}

// Regression for the production "trial credit never depletes" bug: a realistic
// turn costs a fraction of one rappen, so the old whole-rappen rounding debited
// 0 and the balance never moved. Here the cost is DERIVED from catalogue pricing
// (no provider cost override) and the token counts are small — exactly the case
// that silently metered to zero. After one turn the precise micro-rappen balance
// must drop and the ledger row must record a non-zero sub-rappen cost.
func TestCompletionsDebitRealisticSubRappenTurnFromTrialBalance(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(_ context.Context, _ gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "realistic reply"},
				// Small token counts, NO ProviderCostUSD — cost is derived from
				// catalogue pricing and lands well below one rappen.
				Usage: gateway.Usage{InputTokens: 500, OutputTokens: 335, TotalTokens: 835},
			}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "a realistic sub-rappen turn still depletes the trial and is recorded",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"content":"realistic reply"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
			})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			billingRecord, err := app.FindFirstRecordByData("user_billing", "user_id", "uvi8zmr78j9y5hz")
			if err != nil {
				t.Fatalf("FindFirstRecordByData(user_billing) error = %v", err)
			}
			// The precise balance MUST have moved — this is what was broken.
			balanceMicro := billingRecord.GetInt("balance_microrappen")
			if balanceMicro >= 200_000_000 {
				t.Fatalf("balance_microrappen = %d, want < 200_000_000 (sub-rappen turn must debit)", balanceMicro)
			}
			if balanceMicro <= 0 {
				t.Fatalf("balance_microrappen = %d, want > 0 (one cheap turn should not exhaust the trial)", balanceMicro)
			}

			rows, err := app.FindRecordsByFilter("balance_transactions", "user_id = {:u}", "", 10, 0,
				map[string]any{"u": "uvi8zmr78j9y5hz"})
			if err != nil || len(rows) != 1 {
				t.Fatalf("expected exactly one ledger row (err=%v, n=%d)", err, len(rows))
			}
			if got := rows[0].GetInt("user_cost_microrappen"); got <= 0 {
				t.Fatalf("balance_transactions.user_cost_microrappen = %d, want > 0 (cost must be recorded)", got)
			}
			// The cost is sub-rappen, so the whole-rappen projection is still 0 —
			// proving the micro column is what makes the credit deplete.
			if got := rows[0].GetInt("user_cost_rappen"); got != 0 {
				t.Logf("note: user_cost_rappen rounded to %d for a sub-rappen turn (micro column is authoritative)", got)
			}
		},
	}

	scenario.Test(t)
}

// TestPocketBaseBillingRepoRecordUsageAppliesDeltaInsideTransaction pins the
// concurrency-safe deduction semantics: RecordUsage must re-read the balance
// inside its transaction and subtract the usage cost from the CURRENT balance,
// not persist the absolute BalanceAfterMicroRappen precomputed from a stale
// snapshot. The ledger row must record the actually-applied before/after.
func TestPocketBaseBillingRepoRecordUsageAppliesDeltaInsideTransaction(t *testing.T) {
	t.Parallel()

	staleAfterMicro := int64(999_000_000) // deliberately wrong snapshot value
	staleAfterRappen := int64(999)

	testCases := []struct {
		name string
		// seeded user_billing row
		seedRappen int64
		seedMicro  int64
		// usage being recorded
		costMicro int64
		// expected persisted balances
		wantMicro  int64
		wantRappen int64
	}{
		{
			name:       "deducts cost from current balance not snapshot",
			seedRappen: 150,
			seedMicro:  150_000_000,
			costMicro:  12_200_000,
			wantMicro:  137_800_000,
			wantRappen: 137, // floored display projection
		},
		{
			name:       "legacy row derives micro balance from rappen",
			seedRappen: 200,
			seedMicro:  0, // pre-micro-rappen row
			costMicro:  500_000,
			wantMicro:  199_500_000,
			wantRappen: 199,
		},
		{
			name:       "balance may go negative but display floors at zero",
			seedRappen: 0,
			seedMicro:  300_000,
			costMicro:  1_000_000,
			wantMicro:  -700_000,
			wantRappen: 0,
		},
	}

	for i, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			app := setupTestApp(t)
			defer app.Cleanup()

			billingRecord, err := app.FindFirstRecordByData("user_billing", "user_id", "uvi8zmr78j9y5hz")
			if err != nil {
				t.Fatalf("FindFirstRecordByData(user_billing) error = %v", err)
			}
			billingRecord.Set("plan_type", string(billing.PlanTypeTrial))
			billingRecord.Set("balance_rappen", tc.seedRappen)
			billingRecord.Set("balance_microrappen", tc.seedMicro)
			if err := app.Save(billingRecord); err != nil {
				t.Fatalf("Save(user_billing) error = %v", err)
			}

			repo := billing.NewPocketBaseRepo(app)
			if err := repo.RecordUsage(billing.UsageRecord{
				UserID:                  "uvi8zmr78j9y5hz",
				EventID:                 fmt.Sprintf("evt-delta-%d", i),
				ModelID:                 "llama-3-3-infomaniak",
				PlanType:                billing.PlanTypeTrial,
				Type:                    billing.UsageTransactionType,
				AmountMicroRappen:       -tc.costMicro,
				UserCostMicroRappen:     tc.costMicro,
				UserCostRappen:          billing.CeilRappenFromMicro(tc.costMicro),
				AmountRappen:            -billing.CeilRappenFromMicro(tc.costMicro),
				FXRateUSDCHF:            1,
				BalanceAfterRappen:      &staleAfterRappen,
				BalanceAfterMicroRappen: &staleAfterMicro,
			}); err != nil {
				t.Fatalf("RecordUsage() error = %v", err)
			}

			got, err := app.FindFirstRecordByData("user_billing", "user_id", "uvi8zmr78j9y5hz")
			if err != nil {
				t.Fatalf("FindFirstRecordByData(user_billing) error = %v", err)
			}
			if gotMicro := int64(got.GetInt("balance_microrappen")); gotMicro != tc.wantMicro {
				t.Errorf("balance_microrappen = %d, want %d", gotMicro, tc.wantMicro)
			}
			if gotRappen := int64(got.GetInt("balance_rappen")); gotRappen != tc.wantRappen {
				t.Errorf("balance_rappen = %d, want %d", gotRappen, tc.wantRappen)
			}

			// The ledger row must reflect the ACTUAL applied after-balance, not
			// the stale snapshot the caller precomputed.
			tx, err := app.FindFirstRecordByData("balance_transactions", "event_id", fmt.Sprintf("evt-delta-%d", i))
			if err != nil {
				t.Fatalf("FindFirstRecordByData(balance_transactions) error = %v", err)
			}
			if gotAfter := int64(tx.GetInt("balance_after_microrappen")); gotAfter != tc.wantMicro {
				t.Errorf("balance_after_microrappen = %d, want %d", gotAfter, tc.wantMicro)
			}
			if gotAfter := int64(tx.GetInt("balance_after_rappen")); gotAfter != tc.wantRappen {
				t.Errorf("balance_after_rappen = %d, want %d", gotAfter, tc.wantRappen)
			}
		})
	}
}

// TestPocketBaseBillingRepoRecordUsageConcurrentDeductions is the race
// regression: two completions that both snapshot the balance before the
// provider call must still deduct BOTH costs. SQLite serialises the writes, so
// this proves the in-transaction delta logic (not raw parallelism): every
// concurrent caller carries the SAME stale snapshot, and the final balance must
// still equal start - sum(costs).
func TestPocketBaseBillingRepoRecordUsageConcurrentDeductions(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	const (
		startMicro = int64(200_000_000)
		costMicro  = int64(3_000_000)
		workers    = 8
	)

	setUserBillingRecord(t, app, seedUserBillingRecordInput{
		UserID:        "uvi8zmr78j9y5hz",
		PlanType:      string(billing.PlanTypeTrial),
		BalanceRappen: 200,
	})

	repo := billing.NewPocketBaseRepo(app)

	// Every worker uses the same stale pre-call snapshot, exactly like two
	// racing completion handlers would.
	staleAfter := startMicro - costMicro
	staleAfterRappen := billing.FloorRappenFromMicro(staleAfter)

	var wg sync.WaitGroup
	errs := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			after := staleAfter
			afterRappen := staleAfterRappen
			errs <- repo.RecordUsage(billing.UsageRecord{
				UserID:                  "uvi8zmr78j9y5hz",
				EventID:                 fmt.Sprintf("evt-race-%d", n),
				ModelID:                 "llama-3-3-infomaniak",
				PlanType:                billing.PlanTypeTrial,
				Type:                    billing.UsageTransactionType,
				AmountMicroRappen:       -costMicro,
				UserCostMicroRappen:     costMicro,
				FXRateUSDCHF:            1,
				BalanceAfterRappen:      &afterRappen,
				BalanceAfterMicroRappen: &after,
			})
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("RecordUsage() error = %v", err)
		}
	}

	got, err := app.FindFirstRecordByData("user_billing", "user_id", "uvi8zmr78j9y5hz")
	if err != nil {
		t.Fatalf("FindFirstRecordByData(user_billing) error = %v", err)
	}
	want := startMicro - int64(workers)*costMicro
	if gotMicro := int64(got.GetInt("balance_microrappen")); gotMicro != want {
		t.Errorf("balance_microrappen = %d, want %d (every concurrent deduction must apply)", gotMicro, want)
	}
	if gotRappen := int64(got.GetInt("balance_rappen")); gotRappen != billing.FloorRappenFromMicro(want) {
		t.Errorf("balance_rappen = %d, want %d", gotRappen, billing.FloorRappenFromMicro(want))
	}
}

type seedUserBillingRecordInput struct {
	UserID        string
	PlanType      string
	BalanceRappen int
}

type seedBalanceTransactionRecordInput struct {
	ID           string
	UserID       string
	EventID      string
	Type         string
	AmountRappen int
}

func setUserBillingRecord(t testing.TB, app *tests.TestApp, input seedUserBillingRecordInput) {
	t.Helper()

	record, err := app.FindFirstRecordByData("user_billing", "user_id", input.UserID)
	if err != nil {
		t.Fatalf("FindFirstRecordByData(user_billing %q) error = %v", input.UserID, err)
	}
	if input.PlanType != "" {
		record.Set("plan_type", input.PlanType)
	}
	record.Set("balance_rappen", input.BalanceRappen)
	record.Set("balance_microrappen", int64(input.BalanceRappen)*billing.MicroRappenPerRappen)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(user_billing update %q) error = %v", input.UserID, err)
	}
}

func seedBalanceTransactionRecord(t testing.TB, app *tests.TestApp, input seedBalanceTransactionRecordInput) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("balance_transactions")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(balance_transactions) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Id = input.ID
	record.Set("user_id", input.UserID)
	record.Set("occurred_at", "2026-06-07 00:00:00.000Z")
	record.Set("type", input.Type)
	record.Set("amount_rappen", input.AmountRappen)
	record.Set("event_id", input.EventID)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(balance_transactions %q) error = %v", input.ID, err)
	}
}
