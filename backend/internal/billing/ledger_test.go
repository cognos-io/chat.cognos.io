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

	got := service.BuildUsageRecord(State{PlanType: PlanTypeTrial, BalanceRappen: 200}, BuildUsageRecordInput{
		UserID:       "user-1",
		EventID:      "evt-3",
		ModelID:      "llama-3-3-infomaniak",
		Cost:         cost,
		FXRateUSDCHF: 1,
		InputTokens:  8,
		OutputTokens: 4,
	})

	if got.AmountRappen != -cost.CostRappen {
		t.Errorf("BuildUsageRecord(...).AmountRappen = %d, want %d", got.AmountRappen, -cost.CostRappen)
	}
	if got.BalanceAfterRappen == nil {
		t.Fatal("BuildUsageRecord(...).BalanceAfterRappen = nil, want non-nil")
	}
	if *got.BalanceAfterRappen != 200-cost.CostRappen {
		t.Errorf(
			"BuildUsageRecord(...).BalanceAfterRappen = %d, want %d",
			*got.BalanceAfterRappen,
			200-cost.CostRappen,
		)
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
