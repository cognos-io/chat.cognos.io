package billing

import "math"

const UsageTransactionType = "usage"

type UsageRecord struct {
	UserID   string
	EventID  string
	ModelID  string
	PlanType PlanType
	Type     string
	// *Rappen fields are the rounded projection persisted for readability.
	AmountRappen       int64
	ProviderCostRappen int64
	UserCostRappen     int64
	// *MicroRappen fields are the exact values used for accounting.
	AmountMicroRappen       int64
	ProviderCostMicroRappen int64
	UserCostMicroRappen     int64
	FXRateUSDCHF            float64
	InputTokens             int64
	OutputTokens            int64
	BalanceAfterRappen      *int64
	BalanceAfterMicroRappen *int64
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
	userCostMicroRappen := input.Cost.CostMicroRappen
	providerCostMicroRappen := input.Cost.ProviderCostMicroRappen

	record := UsageRecord{
		UserID:                  input.UserID,
		EventID:                 input.EventID,
		ModelID:                 input.ModelID,
		PlanType:                state.PlanType,
		Type:                    UsageTransactionType,
		ProviderCostRappen:      providerCostRappen,
		UserCostRappen:          userCostRappen,
		ProviderCostMicroRappen: providerCostMicroRappen,
		UserCostMicroRappen:     userCostMicroRappen,
		FXRateUSDCHF:            input.FXRateUSDCHF,
		InputTokens:             input.InputTokens,
		OutputTokens:            input.OutputTokens,
	}

	switch state.PlanType {
	case PlanTypeUnlimited:
		record.AmountRappen = 0
		record.AmountMicroRappen = 0
	case PlanTypeTrial, PlanTypePayG:
		record.AmountRappen = -userCostRappen
		record.AmountMicroRappen = -userCostMicroRappen
		if state.PlanType == PlanTypeTrial {
			balanceAfterMicro := state.BalanceMicroRappen - userCostMicroRappen
			balanceAfter := FloorRappenFromMicro(balanceAfterMicro)
			record.BalanceAfterMicroRappen = &balanceAfterMicro
			record.BalanceAfterRappen = &balanceAfter
		}
	}

	return record
}
