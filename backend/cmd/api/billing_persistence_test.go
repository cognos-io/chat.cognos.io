package main

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/aiagent"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestPocketBaseBillingRepoStateForUserMapsLegacyFlatRateAlias(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	seedUserBillingRecord(t, app, seedUserBillingRecordInput{
		ID:            "billflatrate001",
		UserID:        "uvi8zmr78j9y5hz",
		PlanType:      "flat_rate",
		BalanceRappen: 123,
	})

	repo := billing.NewPocketBaseRepo(app)
	got, err := repo.StateForUser("uvi8zmr78j9y5hz")
	if err != nil {
		t.Fatalf("StateForUser() error = %v", err)
	}
	if got.BillingUserID != "billflatrate001" {
		t.Errorf("StateForUser().BillingUserID = %q, want %q", got.BillingUserID, "billflatrate001")
	}
	if got.PlanType != billing.PlanTypeUnlimited {
		t.Errorf("StateForUser().PlanType = %q, want %q", got.PlanType, billing.PlanTypeUnlimited)
	}
	if got.BalanceRappen != 123 {
		t.Errorf("StateForUser().BalanceRappen = %d, want %d", got.BalanceRappen, 123)
	}
}

func TestPocketBaseBillingRepoStateForUserReturnsErrStateNotFound(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	repo := billing.NewPocketBaseRepo(app)
	_, err := repo.StateForUser("j8prcx3dum2l3kc")
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

	seedUserBillingRecord(t, app, seedUserBillingRecordInput{
		ID:            "billtrialrepo01",
		UserID:        "uvi8zmr78j9y5hz",
		PlanType:      string(billing.PlanTypeTrial),
		BalanceRappen: 200,
	})

	repo := billing.NewPocketBaseRepo(app)
	balanceAfter := int64(188)
	if err := repo.RecordUsage(billing.UsageRecord{
		UserID:             "uvi8zmr78j9y5hz",
		EventID:            "evt-trial-1",
		ModelID:            "llama-3-3-infomaniak",
		PlanType:           billing.PlanTypeTrial,
		Type:               billing.UsageTransactionType,
		AmountRappen:       -12,
		ProviderCostRappen: 10,
		UserCostRappen:     12,
		FXRateUSDCHF:       1,
		InputTokens:        8,
		OutputTokens:       4,
		BalanceAfterRappen: &balanceAfter,
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

	seedUserBillingRecord(t, app, seedUserBillingRecordInput{
		ID:            "billrollback001",
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
	err := repo.RecordUsage(billing.UsageRecord{
		UserID:             "uvi8zmr78j9y5hz",
		EventID:            "evt-duplicate-1",
		ModelID:            "llama-3-3-infomaniak",
		PlanType:           billing.PlanTypeTrial,
		Type:               billing.UsageTransactionType,
		AmountRappen:       -12,
		ProviderCostRappen: 10,
		UserCostRappen:     12,
		FXRateUSDCHF:       1,
		InputTokens:        8,
		OutputTokens:       4,
		BalanceAfterRappen: &balanceAfter,
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
			"agent_id":"cognos:simple-assistant",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"content":"persisted reply"`,
			`"cost_rappen":12`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				UpstreamRepo:   stubUpstreamRepo{upstream: stubUpstream{}},
				GatewayClient:  gatewayClient,
				AIAgentRepo:    aiagent.NewInMemoryAIAgentRepo(nil),
				BillingService: billing.NewService(),
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedUserBillingRecord(t, app, seedUserBillingRecordInput{
				ID:            "billdefault0001",
				UserID:        "uvi8zmr78j9y5hz",
				PlanType:      string(billing.PlanTypeTrial),
				BalanceRappen: 200,
			})
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			billingRecord, err := app.FindFirstRecordByData("user_billing", "user_id", "uvi8zmr78j9y5hz")
			if err != nil {
				t.Fatalf("FindFirstRecordByData(user_billing) error = %v", err)
			}
			if got := billingRecord.GetInt("balance_rappen"); got != 188 {
				t.Fatalf("user_billing.balance_rappen = %d, want %d", got, 188)
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

type seedUserBillingRecordInput struct {
	ID            string
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

func seedUserBillingRecord(t testing.TB, app *tests.TestApp, input seedUserBillingRecordInput) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("user_billing")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(user_billing) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Id = input.ID
	record.Set("user_id", input.UserID)
	record.Set("plan_type", input.PlanType)
	record.Set("balance_rappen", input.BalanceRappen)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(user_billing %q) error = %v", input.ID, err)
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
