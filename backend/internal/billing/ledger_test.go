package billing

import (
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
)

func TestBuildUsageRecordPayGWritesNegativeUsageAmount(t *testing.T) {
	t.Parallel()

	service := NewService()
	cost := service.CalculateCost(catalogueModelForLedgerTest(), Usage{
		InputTokens:  10,
		OutputTokens: 5,
	}, 1)

	got := service.BuildUsageRecord(State{PlanType: PlanTypePayG, BalanceRappen: 0}, BuildUsageRecordInput{
		UserID:       "user-1",
		EventID:      "evt-1",
		ModelID:      "llama-3-3-infomaniak",
		Cost:         cost,
		FXRateUSDCHF: 1,
		InputTokens:  10,
		OutputTokens: 5,
	})

	if got.AmountRappen != -cost.CostRappen {
		t.Errorf("BuildUsageRecord(...).AmountRappen = %d, want %d", got.AmountRappen, -cost.CostRappen)
	}
	if got.UserCostRappen != cost.CostRappen {
		t.Errorf("BuildUsageRecord(...).UserCostRappen = %d, want %d", got.UserCostRappen, cost.CostRappen)
	}
	// The precise sub-rappen cost is what actually accrues toward PayG overage.
	if got.AmountMicroRappen != -cost.CostMicroRappen {
		t.Errorf("BuildUsageRecord(...).AmountMicroRappen = %d, want %d", got.AmountMicroRappen, -cost.CostMicroRappen)
	}
	if got.UserCostMicroRappen != cost.CostMicroRappen {
		t.Errorf("BuildUsageRecord(...).UserCostMicroRappen = %d, want %d", got.UserCostMicroRappen, cost.CostMicroRappen)
	}
	if cost.CostMicroRappen <= 0 {
		t.Errorf("CalculateCost(...).CostMicroRappen = %d, want > 0", cost.CostMicroRappen)
	}
	if got.BalanceAfterRappen != nil {
		t.Errorf("BuildUsageRecord(...).BalanceAfterRappen = %v, want nil", got.BalanceAfterRappen)
	}
}

func TestBuildUsageRecordUnlimitedRecordsMetadataWithoutDeduction(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.25
	service := NewService()
	cost := service.CalculateCost(catalogueModelForLedgerTest(), Usage{
		InputTokens:     10,
		OutputTokens:    5,
		ProviderCostUSD: &providerCostUSD,
	}, 1)

	got := service.BuildUsageRecord(State{PlanType: PlanTypeUnlimited}, BuildUsageRecordInput{
		UserID:       "user-1",
		EventID:      "evt-2",
		ModelID:      "llama-3-3-infomaniak",
		Cost:         cost,
		FXRateUSDCHF: 1,
		InputTokens:  10,
		OutputTokens: 5,
	})

	if got.AmountRappen != 0 {
		t.Errorf("BuildUsageRecord(...).AmountRappen = %d, want 0", got.AmountRappen)
	}
	if got.UserCostRappen != cost.CostRappen {
		t.Errorf("BuildUsageRecord(...).UserCostRappen = %d, want %d", got.UserCostRappen, cost.CostRappen)
	}
	if got.ProviderCostRappen != 25 {
		t.Errorf("BuildUsageRecord(...).ProviderCostRappen = %d, want %d", got.ProviderCostRappen, 25)
	}
}

func TestBuildUsageRecordTrialDeductsBalance(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.10
	service := NewService()
	cost := service.CalculateCost(catalogueModelForLedgerTest(), Usage{
		InputTokens:     8,
		OutputTokens:    4,
		ProviderCostUSD: &providerCostUSD,
	}, 1)

	// Seed a full CHF 2.00 trial (200 rappen = 200_000_000 micro-rappen).
	got := service.BuildUsageRecord(
		State{PlanType: PlanTypeTrial, BalanceRappen: 200, BalanceMicroRappen: 200_000_000},
		BuildUsageRecordInput{
			UserID:       "user-1",
			EventID:      "evt-3",
			ModelID:      "llama-3-3-infomaniak",
			Cost:         cost,
			FXRateUSDCHF: 1,
			InputTokens:  8,
			OutputTokens: 4,
		})

	// cost = 0.10 USD * 1.22 margin * 1 fx = 0.122 CHF = 12_200_000 micro-rappen.
	if got.AmountMicroRappen != -cost.CostMicroRappen {
		t.Errorf("BuildUsageRecord(...).AmountMicroRappen = %d, want %d", got.AmountMicroRappen, -cost.CostMicroRappen)
	}
	if got.BalanceAfterMicroRappen == nil {
		t.Fatal("BuildUsageRecord(...).BalanceAfterMicroRappen = nil, want non-nil")
	}
	wantMicro := int64(200_000_000) - cost.CostMicroRappen
	if *got.BalanceAfterMicroRappen != wantMicro {
		t.Errorf("BuildUsageRecord(...).BalanceAfterMicroRappen = %d, want %d", *got.BalanceAfterMicroRappen, wantMicro)
	}
	// Displayed remaining balance floors down so we never overstate credit:
	// 187_800_000 micro-rappen -> 187 rappen.
	if got.BalanceAfterRappen == nil || *got.BalanceAfterRappen != 187 {
		t.Errorf("BuildUsageRecord(...).BalanceAfterRappen = %v, want 187", got.BalanceAfterRappen)
	}
}

func catalogueModelForLedgerTest() catalogue.Model {
	return catalogue.Model{
		Pricing: catalogue.Pricing{
			InputUSDPerMillionTokens:  1,
			OutputUSDPerMillionTokens: 2,
		},
	}
}
