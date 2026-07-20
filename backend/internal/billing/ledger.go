package billing

import "math"

const UsageTransactionType = "usage"

// OperationType records which kind of paid operation produced a usage record so
// billing and analytics can distinguish image generation from text completion
// without ever inspecting the (encrypted) content.
type OperationType string

const (
	OperationTypeText            OperationType = "text"
	OperationTypeImageGeneration OperationType = "image_generation"
)

type UsageRecord struct {
	UserID string
	// OrganisationID attributes the usage to an Organisation's pooled PAYG
	// cycle (org-owned Project scope). Empty for personal usage. UserID is
	// always kept alongside it — the acting Account, for audit and per-member
	// metadata. Org usage never touches any balance: orgs have no trial or
	// prepaid credit, so the row only accrues toward the pooled cycle.
	OrganisationID string
	EventID        string
	ModelID        string
	PlanType       PlanType
	Type           string
	// OperationType flags whether this usage came from a text completion or an
	// image generation. Defaults to OperationTypeText.
	OperationType OperationType
	// GeneratedImageCount is the number of images produced (0 for text).
	GeneratedImageCount int64
	// SearchCount is the number of provider web searches this usage
	// performed (0 when web search was off or unused). Recorded for
	// reconciliation; search itself is still a "text" OperationType, not a
	// new one (spec §5.4).
	SearchCount int64
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
	UserID string
	// OrganisationID marks the usage as org-attributed (see
	// UsageRecord.OrganisationID). Empty for personal usage.
	OrganisationID string
	EventID        string
	ModelID        string
	Cost           CostBreakdown
	FXRateUSDCHF   float64
	InputTokens    int64
	OutputTokens   int64
	// OperationType defaults to OperationTypeText when empty.
	OperationType OperationType
	// GeneratedImageCount is the number of images produced (0 for text).
	GeneratedImageCount int64
	// SearchCount is the number of provider web searches this usage
	// performed (0 for a normal completion).
	SearchCount int64
}

type LedgerRepo interface {
	RecordUsage(record UsageRecord) error
}

func (s *Service) BuildUsageRecord(state State, input BuildUsageRecordInput) UsageRecord {
	providerCostRappen := int64(math.Round(input.Cost.ProviderCostUSD * input.FXRateUSDCHF * 100))
	userCostRappen := input.Cost.CostRappen
	userCostMicroRappen := input.Cost.CostMicroRappen
	providerCostMicroRappen := input.Cost.ProviderCostMicroRappen

	operationType := input.OperationType
	if operationType == "" {
		operationType = OperationTypeText
	}

	record := UsageRecord{
		UserID:                  input.UserID,
		OrganisationID:          input.OrganisationID,
		EventID:                 input.EventID,
		ModelID:                 input.ModelID,
		PlanType:                state.PlanType,
		Type:                    UsageTransactionType,
		OperationType:           operationType,
		GeneratedImageCount:     input.GeneratedImageCount,
		SearchCount:             input.SearchCount,
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
		// Org-attributed usage never projects a balance: orgs have no trial
		// or prepaid credit, only the pooled PAYG cycle (fail-closed gate
		// upstream guarantees the plan is payg, this is belt and braces).
		if state.PlanType == PlanTypeTrial && record.OrganisationID == "" {
			balanceAfterMicro := state.BalanceMicroRappen - userCostMicroRappen
			balanceAfter := FloorRappenFromMicro(balanceAfterMicro)
			record.BalanceAfterMicroRappen = &balanceAfterMicro
			record.BalanceAfterRappen = &balanceAfter
		}
	}

	return record
}
