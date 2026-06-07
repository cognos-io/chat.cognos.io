package billing

import "math"

const UsageTransactionType = "usage"

type UsageRecord struct {
	UserID             string
	EventID            string
	ModelID            string
	PlanType           PlanType
	Type               string
	AmountRappen       int64
	ProviderCostRappen int64
	UserCostRappen     int64
	FXRateUSDCHF       float64
	InputTokens        int64
	OutputTokens       int64
	BalanceAfterRappen *int64
}

type BuildUsageRecordInput struct {
	UserID       string
	EventID      string
	ModelID      string
	Cost         CostBreakdown
	FXRateUSDCHF float64
	InputTokens  int64
	OutputTokens int64
}

type LedgerRepo interface {
	RecordUsage(record UsageRecord) error
}

func (s *Service) BuildUsageRecord(state State, input BuildUsageRecordInput) UsageRecord {
	providerCostRappen := int64(math.Round(input.Cost.ProviderCostUSD * input.FXRateUSDCHF * 100))
	userCostRappen := input.Cost.CostRappen

	record := UsageRecord{
		UserID:             input.UserID,
		EventID:            input.EventID,
		ModelID:            input.ModelID,
		PlanType:           state.PlanType,
		Type:               UsageTransactionType,
		ProviderCostRappen: providerCostRappen,
		UserCostRappen:     userCostRappen,
		FXRateUSDCHF:       input.FXRateUSDCHF,
		InputTokens:        input.InputTokens,
		OutputTokens:       input.OutputTokens,
	}

	switch state.PlanType {
	case PlanTypeUnlimited:
		record.AmountRappen = 0
	case PlanTypeTrial, PlanTypePayG:
		record.AmountRappen = -userCostRappen
		if state.PlanType == PlanTypeTrial {
			balanceAfter := state.BalanceRappen - userCostRappen
			record.BalanceAfterRappen = &balanceAfter
		}
	}

	return record
}
