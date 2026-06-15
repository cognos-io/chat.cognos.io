package billing

import (
	"errors"
	"math"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
)

type PlanType string

const (
	PlanTypeTrial     PlanType = "trial"
	PlanTypePayG      PlanType = "payg"
	PlanTypeUnlimited PlanType = "unlimited"
	PlanTypeInactive  PlanType = "inactive"

	DefaultMarginBPS = 2000
)

var ErrStateNotFound = errors.New("billing state not found")

type State struct {
	PlanType        PlanType
	BalanceRappen   int64
	TrialSeedRappen int64
	BillingUserID   string

	// Dashboard fields (zero/empty when not applicable).
	PaddlePriceID         string
	PlanStartedAt         time.Time
	PlanEndsAt            time.Time // set when a cancellation is scheduled
	CycleStartAt          time.Time // current Paddle billing cycle start
	CycleEndAt            time.Time // renewal / next-charge boundary
	RefundEligibleUntilAt time.Time
}

type StateRepo interface {
	StateForUser(userID string) (State, error)
}

type AccessRestriction struct {
	Error               string
	Message             string
	BalanceRappen       *int64
	EstimatedCostRappen *int64
	NextStep            string
}

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
	ProviderCostUSD          float64
	CostUSD                  float64
	CostCHF                  float64
	CostRappen               int64
	UsedProviderCost         bool
}

type Service struct {
	MarginBPS int64
}

func NewService() *Service {
	return &Service{MarginBPS: DefaultMarginBPS}
}

func (s *Service) CalculateCost(
	model catalogue.Model,
	usage Usage,
	usdToCHFRate float64,
) CostBreakdown {
	providerCostUSD := s.providerCostUSD(model, usage)
	userCostUSD := s.applyMargin(providerCostUSD)
	costCHF := userCostUSD * usdToCHFRate

	return CostBreakdown{
		InputTokens:              usage.InputTokens,
		OutputTokens:             usage.OutputTokens,
		CacheCreationInputTokens: usage.CacheCreationInputTokens,
		CacheReadInputTokens:     usage.CacheReadInputTokens,
		ProviderCostUSD:          providerCostUSD,
		CostUSD:                  userCostUSD,
		CostCHF:                  costCHF,
		CostRappen:               int64(math.Round(costCHF * 100)),
		UsedProviderCost:         usage.ProviderCostUSD != nil,
	}
}

func (s *Service) EstimateUpperBoundCost(
	model catalogue.Model,
	maxOutputTokens int,
	usdToCHFRate float64,
) CostBreakdown {
	if maxOutputTokens <= 0 {
		maxOutputTokens = model.MaxOutputTokens
	}

	return s.CalculateCost(model, Usage{
		InputTokens:  int64(model.InputContextTokens),
		OutputTokens: int64(maxOutputTokens),
	}, usdToCHFRate)
}

func (s *Service) CanAfford(balanceRappen, estimatedCostRappen int64) bool {
	return balanceRappen >= estimatedCostRappen
}

func (s *Service) EvaluateAccess(state State, estimatedCostRappen int64) *AccessRestriction {
	switch state.PlanType {
	case PlanTypeInactive:
		return &AccessRestriction{
			Error:    "INACTIVE",
			Message:  "Choose a plan to keep chatting.",
			NextStep: "subscribe",
		}
	case PlanTypeTrial:
		if estimatedCostRappen > 0 && !s.CanAfford(state.BalanceRappen, estimatedCostRappen) {
			return &AccessRestriction{
				Error:               "TRIAL_EXHAUSTED",
				Message:             "Your free trial has been used up.",
				BalanceRappen:       int64Ptr(state.BalanceRappen),
				EstimatedCostRappen: int64Ptr(estimatedCostRappen),
				NextStep:            "subscribe",
			}
		}
	}

	return nil
}

func (s *Service) applyMargin(providerCostUSD float64) float64 {
	return providerCostUSD * (1 + float64(s.MarginBPS)/10_000)
}

func (s *Service) providerCostUSD(model catalogue.Model, usage Usage) float64 {
	if usage.ProviderCostUSD != nil {
		return *usage.ProviderCostUSD
	}

	inputCost := float64(usage.InputTokens) / 1_000_000 * model.Pricing.InputUSDPerMillionTokens
	outputCost := float64(usage.OutputTokens) / 1_000_000 * model.Pricing.OutputUSDPerMillionTokens
	return inputCost + outputCost
}

func int64Ptr(v int64) *int64 {
	return &v
}
