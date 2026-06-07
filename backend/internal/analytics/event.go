package analytics

import (
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
)

type UsageEvent struct {
	EventID                  string
	OccurredAt               time.Time
	BillingPeriod            string
	BillingUserID            string
	PlanType                 string
	ModelID                  string
	Provider                 string
	PrivacyTier              string
	ContentType              string
	InputTokens              int64
	OutputTokens             int64
	CacheCreationInputTokens int64
	CacheReadInputTokens     int64
	ProviderCostUSD          float64
	UsedProviderCost         bool
	CostUSD                  float64
	CostCHF                  float64
	FXRateUSDCHF             float64
	LatencyMS                int64
}

type BuildUsageEventInput struct {
	EventID       string
	OccurredAt    time.Time
	BillingUserID string
	PlanType      billing.PlanType
	Model         catalogue.Model
	PrivacyTier   catalogue.PrivacyTier
	Cost          billing.CostBreakdown
	FXRateUSDCHF  float64
	LatencyMS     int64
}

func BuildUsageEvent(input BuildUsageEventInput) UsageEvent {
	occurredAt := input.OccurredAt.UTC()
	if occurredAt.IsZero() {
		occurredAt = time.Now().UTC()
	}

	return UsageEvent{
		EventID:                  input.EventID,
		OccurredAt:               occurredAt,
		BillingPeriod:            occurredAt.Format("2006-01"),
		BillingUserID:            input.BillingUserID,
		PlanType:                 string(input.PlanType),
		ModelID:                  input.Model.ID,
		Provider:                 input.Model.ProviderID,
		PrivacyTier:              string(input.PrivacyTier),
		ContentType:              string(catalogue.ContentTypeText),
		InputTokens:              input.Cost.InputTokens,
		OutputTokens:             input.Cost.OutputTokens,
		CacheCreationInputTokens: input.Cost.CacheCreationInputTokens,
		CacheReadInputTokens:     input.Cost.CacheReadInputTokens,
		ProviderCostUSD:          input.Cost.ProviderCostUSD,
		UsedProviderCost:         input.Cost.UsedProviderCost,
		CostUSD:                  input.Cost.CostUSD,
		CostCHF:                  input.Cost.CostCHF,
		FXRateUSDCHF:             input.FXRateUSDCHF,
		LatencyMS:                input.LatencyMS,
	}
}
