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

	// DefaultWebSearchFloorMicroRappen is the per-search floor fee added to a
	// completion's cost whenever it counted any provider web searches
	// (Usage.SearchCount > 0), configurable via
	// billing.web_search_floor_micro_rappen. MicroRappenPerRappen =
	// 1_000_000 micro-rappen per rappen — do not confuse the two units.
	// Unset or non-positive configuration always falls back to this default;
	// it must never resolve to zero, or search would be silently free.
	DefaultWebSearchFloorMicroRappen = 1_100_000
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
	// SearchCount is the number of provider web searches this completion
	// performed (0 when web search was off or unused). Drives the
	// per-search floor fee in CalculateCost regardless of whether
	// ProviderCostUSD is also set (spec §5.4 Decision 4, amended by the
	// spike — Requesty has not confirmed its reported cost includes the
	// provider's own search fee).
	SearchCount int64
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
	// SearchCount mirrors the Usage.SearchCount that produced this
	// breakdown, so callers building a ledger record don't need to re-read
	// gateway.Usage.
	SearchCount int64
}

type Service struct {
	MarginBPS int64
	// WebSearchFloorMicroRappen is the per-search fee CalculateCost adds
	// whenever Usage.SearchCount > 0. Always positive — see
	// DefaultWebSearchFloorMicroRappen.
	WebSearchFloorMicroRappen int64
}

func NewService() *Service {
	return NewServiceWithOptions(DefaultMarginBPS, DefaultWebSearchFloorMicroRappen)
}

// NewServiceWithMargin builds a Service with a configurable markup in basis
// points and the default web-search floor fee. Non-positive margin falls
// back to DefaultMarginBPS.
func NewServiceWithMargin(marginBPS int64) *Service {
	return NewServiceWithOptions(marginBPS, DefaultWebSearchFloorMicroRappen)
}

// NewServiceWithOptions builds a Service with a configurable margin (basis
// points) and web-search floor fee (micro-rappen per search). Non-positive
// values fall back to their defaults — the floor in particular must never
// resolve to zero, or search would be silently free.
func NewServiceWithOptions(marginBPS, webSearchFloorMicroRappen int64) *Service {
	if marginBPS <= 0 {
		marginBPS = DefaultMarginBPS
	}
	if webSearchFloorMicroRappen <= 0 {
		webSearchFloorMicroRappen = DefaultWebSearchFloorMicroRappen
	}
	return &Service{MarginBPS: marginBPS, WebSearchFloorMicroRappen: webSearchFloorMicroRappen}
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
	// Round the usage-derived cost before adding the already-integral search
	// fee. Combining both as floats before rounding can shift the fee by one
	// micro-rappen at a rounding boundary.
	baseCostMicroRappen := int64(math.Round(costCHF * 100 * MicroRappenPerRappen))

	// Web-search floor fee: added whenever the completion counted any search
	// invocations, REGARDLESS of whether a provider-reported total was
	// trusted above (UsedProviderCost). Requesty has not confirmed that its
	// reported cost includes the underlying provider's own search fee (spec
	// §14 Q1), so Decision 4 as amended by the spike is to always add the
	// floor on top when SearchCount > 0 — over-charging slightly beats
	// silently eating the cost, and revisit once pass-through is confirmed.
	//
	// WebSearchFloorMicroRappen is already a user-facing, post-margin price
	// (the configured default is seeded from the provider's per-search fee
	// *plus* margin baked in — see DefaultWebSearchFloorMicroRappen), so it
	// is added directly in CHF/micro-rappen terms here rather than run back
	// through applyMargin, which would margin it a second time.
	var searchFloorMicroRappen int64
	if usage.SearchCount > 0 {
		searchFloorMicroRappen = usage.SearchCount * s.WebSearchFloorMicroRappen
	}
	// 1 CHF = 100 rappen = 100 * MicroRappenPerRappen micro-rappen.
	searchFloorCHF := float64(searchFloorMicroRappen) / (100 * MicroRappenPerRappen)
	costCHF += searchFloorCHF
	if usdToCHFRate > 0 {
		userCostUSD += searchFloorCHF / usdToCHFRate
	}

	return CostBreakdown{
		InputTokens:              usage.InputTokens,
		OutputTokens:             usage.OutputTokens,
		CacheCreationInputTokens: usage.CacheCreationInputTokens,
		CacheReadInputTokens:     usage.CacheReadInputTokens,
		ProviderCostUSD:          providerCostUSD,
		CostUSD:                  userCostUSD,
		CostCHF:                  costCHF,
		CostRappen:               int64(math.Round(costCHF * 100)),
		// Add the integral search fee after rounding the usage-derived CHF cost
		// so the configured per-search amount remains exactly additive.
		CostMicroRappen:         baseCostMicroRappen + searchFloorMicroRappen,
		ProviderCostMicroRappen: int64(math.Round(providerCostCHF * 100 * MicroRappenPerRappen)),
		UsedProviderCost:        usage.ProviderCostUSD != nil,
		SearchCount:             usage.SearchCount,
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
