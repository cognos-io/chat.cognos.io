package billing

import (
	"math"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
)

type Usage struct {
	InputTokens              int64
	OutputTokens             int64
	CacheCreationInputTokens int64
	CacheReadInputTokens     int64
	ProviderCostUSD          *float64
}

type CostBreakdown struct {
	InputTokens              int64
	OutputTokens             int64
	CacheCreationInputTokens int64
	CacheReadInputTokens     int64
	CostUSD                  float64
	CostCHF                  float64
	CostRappen               int64
	UsedProviderCost         bool
}

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) CalculateCost(
	model catalogue.Model,
	usage Usage,
	usdToCHFRate float64,
) CostBreakdown {
	costUSD := s.costUSD(model, usage)
	costCHF := costUSD * usdToCHFRate

	return CostBreakdown{
		InputTokens:              usage.InputTokens,
		OutputTokens:             usage.OutputTokens,
		CacheCreationInputTokens: usage.CacheCreationInputTokens,
		CacheReadInputTokens:     usage.CacheReadInputTokens,
		CostUSD:                  costUSD,
		CostCHF:                  costCHF,
		CostRappen:               int64(math.Round(costCHF * 100)),
		UsedProviderCost:         usage.ProviderCostUSD != nil,
	}
}

func (s *Service) CanAfford(balanceRappen, estimatedCostRappen int64) bool {
	return balanceRappen >= estimatedCostRappen
}

func (s *Service) costUSD(model catalogue.Model, usage Usage) float64 {
	if usage.ProviderCostUSD != nil {
		return *usage.ProviderCostUSD
	}

	inputCost := float64(usage.InputTokens) / 1_000_000 * model.Pricing.InputUSDPerMillionTokens
	outputCost := float64(usage.OutputTokens) / 1_000_000 * model.Pricing.OutputUSDPerMillionTokens
	return inputCost + outputCost
}
