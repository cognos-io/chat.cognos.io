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

	// DefaultMarginBPS is the markup applied to the provider's cost, in basis
	// points (2200 = 22%). Configurable via billing.margin_bps.
	DefaultMarginBPS = 2200

	// MicroRappenPerRappen is the precision we meter usage at internally. A
	// single chat turn costs a fraction of one rappen, so we accumulate the
	// exact cost in micro-rappen and only round to whole rappen when money
	// actually leaves the system (balance display, Paddle charge).
	MicroRappenPerRappen = 1_000_000
)

// CeilRappenFromMicro converts a non-negative micro-rappen amount to whole
// rappen, always rounding up so we never undercharge.
func CeilRappenFromMicro(microRappen int64) int64 {
	if microRappen <= 0 {
		return 0
	}
	return (microRappen + MicroRappenPerRappen - 1) / MicroRappenPerRappen
}

// FloorRappenFromMicro converts a micro-rappen balance to whole rappen, rounding
// down so we never overstate remaining credit (the mirror of charging up).
func FloorRappenFromMicro(microRappen int64) int64 {
	if microRappen <= 0 {
		return 0
	}
	return microRappen / MicroRappenPerRappen
}

var ErrStateNotFound = errors.New("billing state not found")

type State struct {
	PlanType PlanType
	// BalanceRappen is the whole-rappen projection of the balance for display.
	BalanceRappen int64
	// BalanceMicroRappen is the precise balance used for all accounting.
	BalanceMicroRappen int64
	TrialSeedRappen    int64
	BillingUserID      string

	// Dashboard fields (zero/empty when not applicable).
	PaddlePriceID         string
	PlanStartedAt         time.Time
	PlanEndsAt            time.Time // set when a cancellation is scheduled
	CycleStartAt          time.Time // current Paddle billing cycle start
	CycleEndAt            time.Time // renewal / next-charge boundary
	RefundEligibleUntilAt time.Time
	PastDue               bool // a renewal payment failed; Paddle is dunning
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
	// CostMicroRappen is the exact user cost in micro-rappen — the value used
	// for accounting. CostRappen is the rounded projection for display only.
	CostMicroRappen         int64
	ProviderCostMicroRappen int64
	UsedProviderCost        bool
}

type Service struct {
	MarginBPS int64
}

func NewService() *Service {
	return NewServiceWithMargin(DefaultMarginBPS)
}

// NewServiceWithMargin builds a Service with a configurable markup in basis
// points. Non-positive values fall back to DefaultMarginBPS.
func NewServiceWithMargin(marginBPS int64) *Service {
	if marginBPS <= 0 {
		marginBPS = DefaultMarginBPS
	}
	return &Service{MarginBPS: marginBPS}
}

func (s *Service) CalculateCost(
	model catalogue.Model,
	usage Usage,
	usdToCHFRate float64,
) CostBreakdown {
	providerCostUSD := s.providerCostUSD(model, usage)
	userCostUSD := s.applyMargin(providerCostUSD)
	costCHF := userCostUSD * usdToCHFRate
	providerCostCHF := providerCostUSD * usdToCHFRate

	return CostBreakdown{
		InputTokens:              usage.InputTokens,
		OutputTokens:             usage.OutputTokens,
		CacheCreationInputTokens: usage.CacheCreationInputTokens,
		CacheReadInputTokens:     usage.CacheReadInputTokens,
		ProviderCostUSD:          providerCostUSD,
		CostUSD:                  userCostUSD,
		CostCHF:                  costCHF,
		CostRappen:               int64(math.Round(costCHF * 100)),
		// 1 CHF = 100 rappen = 100 * MicroRappenPerRappen micro-rappen, so
		// CHF * 1e8 yields micro-rappen.
		CostMicroRappen:         int64(math.Round(costCHF * 100 * MicroRappenPerRappen)),
		ProviderCostMicroRappen: int64(math.Round(providerCostCHF * 100 * MicroRappenPerRappen)),
		UsedProviderCost:        usage.ProviderCostUSD != nil,
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

func (s *Service) CanAfford(balanceMicroRappen, estimatedCostMicroRappen int64) bool {
	return balanceMicroRappen >= estimatedCostMicroRappen
}

func (s *Service) EvaluateAccess(state State, estimatedCostMicroRappen int64) *AccessRestriction {
	switch state.PlanType {
	case PlanTypeInactive:
		return &AccessRestriction{
			Error:    "INACTIVE",
			Message:  "Choose a plan to keep chatting.",
			NextStep: "subscribe",
		}
	case PlanTypeTrial:
		if estimatedCostMicroRappen > 0 && !s.CanAfford(state.BalanceMicroRappen, estimatedCostMicroRappen) {
			return &AccessRestriction{
				Error:               "TRIAL_EXHAUSTED",
				Message:             "Your free trial has been used up.",
				BalanceRappen:       int64Ptr(state.BalanceRappen),
				EstimatedCostRappen: int64Ptr(CeilRappenFromMicro(estimatedCostMicroRappen)),
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
