package billing

import (
	"math"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
)

func TestCalculateCostUsesProviderCostWhenAvailable(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.1234
	wantUserCostUSD := providerCostUSD * 1.22
	service := NewService()
	model := catalogue.Model{
		Pricing: catalogue.Pricing{
			InputUSDPerMillionTokens:  1,
			OutputUSDPerMillionTokens: 2,
		},
	}

	got := service.CalculateCost(model, Usage{
		InputTokens:              100,
		OutputTokens:             200,
		CacheCreationInputTokens: 3,
		CacheReadInputTokens:     4,
		ProviderCostUSD:          &providerCostUSD,
	}, 0.91)

	if diff := math.Abs(got.ProviderCostUSD - providerCostUSD); diff > 1e-9 {
		t.Errorf("CalculateCost(...).ProviderCostUSD = %f, want %f", got.ProviderCostUSD, providerCostUSD)
	}
	if diff := math.Abs(got.CostUSD - wantUserCostUSD); diff > 1e-9 {
		t.Errorf("CalculateCost(...).CostUSD = %f, want %f", got.CostUSD, wantUserCostUSD)
	}
	if !got.UsedProviderCost {
		t.Error("CalculateCost(...).UsedProviderCost = false, want true")
	}
	if got.CacheCreationInputTokens != 3 {
		t.Errorf("CalculateCost(...).CacheCreationInputTokens = %d, want %d", got.CacheCreationInputTokens, 3)
	}
	if got.CacheReadInputTokens != 4 {
		t.Errorf("CalculateCost(...).CacheReadInputTokens = %d, want %d", got.CacheReadInputTokens, 4)
	}
}

func TestCalculateCostDerivesCostFromCataloguePricing(t *testing.T) {
	t.Parallel()

	service := NewService()
	model := catalogue.Model{
		Pricing: catalogue.Pricing{
			InputUSDPerMillionTokens:  2.50,
			OutputUSDPerMillionTokens: 10.00,
		},
	}

	got := service.CalculateCost(model, Usage{
		InputTokens:  200_000,
		OutputTokens: 50_000,
	}, 0.90)

	wantProviderUSD := 1.0
	wantUserUSD := 1.22
	wantCHF := 1.098
	wantRappen := int64(110)

	if diff := math.Abs(got.ProviderCostUSD - wantProviderUSD); diff > 1e-9 {
		t.Errorf("CalculateCost(...).ProviderCostUSD = %f, want %f", got.ProviderCostUSD, wantProviderUSD)
	}
	if diff := math.Abs(got.CostUSD - wantUserUSD); diff > 1e-9 {
		t.Errorf("CalculateCost(...).CostUSD = %f, want %f", got.CostUSD, wantUserUSD)
	}
	if diff := math.Abs(got.CostCHF - wantCHF); diff > 1e-9 {
		t.Errorf("CalculateCost(...).CostCHF = %f, want %f", got.CostCHF, wantCHF)
	}
	if got.CostRappen != wantRappen {
		t.Errorf("CalculateCost(...).CostRappen = %d, want %d", got.CostRappen, wantRappen)
	}
	if got.UsedProviderCost {
		t.Error("CalculateCost(...).UsedProviderCost = true, want false")
	}
}

func TestCalculateCostRoundsToNearestRappen(t *testing.T) {
	t.Parallel()

	service := NewService()
	providerCostUSD := 0.105

	got := service.CalculateCost(catalogue.Model{}, Usage{ProviderCostUSD: &providerCostUSD}, 1)
	if got.CostRappen != 13 {
		t.Errorf("CalculateCost(...).CostRappen = %d, want %d", got.CostRappen, 13)
	}
}

// Regression for the "trial credit never depletes" bug. A normal Infomaniak
// Gemma turn (~500 input / 335 output tokens at $1/$2 per Mtok, fx 0.88) costs
// roughly 0.12 rappen. The whole-rappen projection rounds that to 0 — which is
// exactly why summing it never depleted the trial or accrued PayG overage. The
// precise micro-rappen value must capture the real cost so it accumulates.
func TestRealisticTurnIsMeteredInMicroRappen(t *testing.T) {
	t.Parallel()

	service := NewService()
	model := catalogue.Model{
		Pricing: catalogue.Pricing{
			InputUSDPerMillionTokens:  1,
			OutputUSDPerMillionTokens: 2,
		},
	}

	got := service.CalculateCost(model, Usage{
		InputTokens:  500,
		OutputTokens: 335,
	}, 0.88)

	// provider 0.00117 USD * 1.22 margin * 0.88 fx = 0.001256112 CHF
	// = 0.1256112 rappen = 125611 micro-rappen (rounded).
	wantMicro := int64(125611)
	if got.CostMicroRappen != wantMicro {
		t.Errorf("CalculateCost(realistic turn).CostMicroRappen = %d, want %d", got.CostMicroRappen, wantMicro)
	}
	// The whole-rappen projection rounds a sub-rappen turn to 0 — documenting
	// why per-turn rappen accounting silently metered to nothing.
	if got.CostRappen != 0 {
		t.Errorf("CalculateCost(realistic turn).CostRappen = %d, want 0 (sub-rappen rounds away)", got.CostRappen)
	}
	// The metered (micro) cost must be strictly positive so it accumulates.
	if got.CostMicroRappen <= 0 {
		t.Errorf("CalculateCost(realistic turn).CostMicroRappen = %d, want > 0", got.CostMicroRappen)
	}
}

// Many realistic sub-rappen turns must accumulate into a real, deductible
// amount — the property that the old per-turn rounding destroyed.
func TestSubRappenTurnsAccumulateAcrossASession(t *testing.T) {
	t.Parallel()

	service := NewService()
	model := catalogue.Model{
		Pricing: catalogue.Pricing{
			InputUSDPerMillionTokens:  1,
			OutputUSDPerMillionTokens: 2,
		},
	}

	const turns = 100
	var totalMicro int64
	for range turns {
		got := service.CalculateCost(model, Usage{InputTokens: 500, OutputTokens: 335}, 0.88)
		totalMicro += got.CostMicroRappen
	}

	// 100 * 125611 = 12_561_100 micro-rappen -> ceil to 13 whole rappen.
	if totalMicro != 12_561_100 {
		t.Errorf("accumulated micro-rappen = %d, want %d", totalMicro, 12_561_100)
	}
	if got := CeilRappenFromMicro(totalMicro); got != 13 {
		t.Errorf("CeilRappenFromMicro(session total) = %d, want 13", got)
	}
}

func TestEstimateUpperBoundCostUsesCataloguePricingAndMargin(t *testing.T) {
	t.Parallel()

	service := NewService()
	model := catalogue.Model{
		InputContextTokens: 128_000,
		MaxOutputTokens:    8_192,
		Pricing: catalogue.Pricing{
			InputUSDPerMillionTokens:  1,
			OutputUSDPerMillionTokens: 2,
		},
	}

	got := service.EstimateUpperBoundCost(model, 0, 1)

	wantProviderUSD := 0.144384
	wantUserUSD := wantProviderUSD * 1.22
	wantRappen := int64(18)

	if diff := math.Abs(got.ProviderCostUSD - wantProviderUSD); diff > 1e-6 {
		t.Errorf("EstimateUpperBoundCost(...).ProviderCostUSD = %f, want %f", got.ProviderCostUSD, wantProviderUSD)
	}
	if diff := math.Abs(got.CostUSD - wantUserUSD); diff > 1e-6 {
		t.Errorf("EstimateUpperBoundCost(...).CostUSD = %f, want %f", got.CostUSD, wantUserUSD)
	}
	if got.CostRappen != wantRappen {
		t.Errorf("EstimateUpperBoundCost(...).CostRappen = %d, want %d", got.CostRappen, wantRappen)
	}
}

func TestCanAfford(t *testing.T) {
	t.Parallel()

	service := NewService()

	tests := []struct {
		name                string
		balanceRappen       int64
		estimatedCostRappen int64
		want                bool
	}{
		{name: "enough balance", balanceRappen: 100, estimatedCostRappen: 100, want: true},
		{name: "more than enough balance", balanceRappen: 101, estimatedCostRappen: 100, want: true},
		{name: "insufficient balance", balanceRappen: 99, estimatedCostRappen: 100, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := service.CanAfford(tt.balanceRappen, tt.estimatedCostRappen)
			if got != tt.want {
				t.Errorf("CanAfford(%d, %d) = %t, want %t", tt.balanceRappen, tt.estimatedCostRappen, got, tt.want)
			}
		})
	}
}

func TestParsePlanType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		want    PlanType
		wantErr bool
	}{
		{name: "trial", input: "trial", want: PlanTypeTrial},
		{name: "payg", input: "payg", want: PlanTypePayG},
		{name: "unlimited", input: "unlimited", want: PlanTypeUnlimited},
		{name: "inactive", input: "inactive", want: PlanTypeInactive},
		{name: "legacy flat rate alias", input: "flat_rate", want: PlanTypeUnlimited},
		{name: "whitespace padded", input: "  trial  ", want: PlanTypeTrial},
		{name: "tab padded legacy alias", input: "\tflat_rate\n", want: PlanTypeUnlimited},
		{name: "empty rejected", input: "", wantErr: true},
		{name: "whitespace only rejected", input: "   ", wantErr: true},
		{name: "case mismatch rejected", input: "Trial", wantErr: true},
		{name: "unknown", input: "nope", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := ParsePlanType(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("ParsePlanType(%q) error = nil, want non-nil", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParsePlanType(%q) error = %v", tt.input, err)
			}
			if got != tt.want {
				t.Errorf("ParsePlanType(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestEvaluateAccess(t *testing.T) {
	t.Parallel()

	service := NewService()

	tests := []struct {
		name                     string
		state                    State
		estimatedCostMicroRappen int64
		wantError                string
		wantMessage              string
		wantBalanceRappen        *int64
		wantEstimatedRappen      *int64
	}{
		{
			name:        "inactive users must subscribe",
			state:       State{PlanType: PlanTypeInactive},
			wantError:   "INACTIVE",
			wantMessage: "Choose a plan to keep chatting.",
		},
		{
			name:                     "trial users are blocked when balance is too low",
			state:                    State{PlanType: PlanTypeTrial, BalanceRappen: 2, BalanceMicroRappen: 2_000_000},
			estimatedCostMicroRappen: 32_000_000,
			wantError:                "TRIAL_EXHAUSTED",
			wantMessage:              "Your free trial has been used up.",
			wantBalanceRappen:        int64Ptr(2),
			wantEstimatedRappen:      int64Ptr(32),
		},
		{
			// A sub-rappen estimate that the balance cannot cover still blocks,
			// and the displayed estimate rounds up to a visible 1 rappen.
			name:                     "trial users blocked by a sub-rappen estimate report a ceiled cost",
			state:                    State{PlanType: PlanTypeTrial, BalanceRappen: 0, BalanceMicroRappen: 1},
			estimatedCostMicroRappen: 125_611,
			wantError:                "TRIAL_EXHAUSTED",
			wantMessage:              "Your free trial has been used up.",
			wantBalanceRappen:        int64Ptr(0),
			wantEstimatedRappen:      int64Ptr(1),
		},
		{
			name:                     "trial users can continue when balance covers the estimate",
			state:                    State{PlanType: PlanTypeTrial, BalanceRappen: 32, BalanceMicroRappen: 32_000_000},
			estimatedCostMicroRappen: 32_000_000,
		},
		{
			name:                     "payg users are not blocked for funds",
			state:                    State{PlanType: PlanTypePayG, BalanceMicroRappen: 0},
			estimatedCostMicroRappen: 320_000_000,
		},
		{
			name:                     "unlimited users are not blocked for funds",
			state:                    State{PlanType: PlanTypeUnlimited, BalanceMicroRappen: 0},
			estimatedCostMicroRappen: 320_000_000,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := service.EvaluateAccess(tt.state, tt.estimatedCostMicroRappen)
			if tt.wantError == "" {
				if got != nil {
					t.Fatalf("EvaluateAccess(...) = %#v, want nil", got)
				}
				return
			}
			if got == nil {
				t.Fatal("EvaluateAccess(...) = nil, want restriction")
				return
			}
			if got.Error != tt.wantError {
				t.Errorf("EvaluateAccess(...).Error = %q, want %q", got.Error, tt.wantError)
			}
			if got.Message != tt.wantMessage {
				t.Errorf("EvaluateAccess(...).Message = %q, want %q", got.Message, tt.wantMessage)
			}
			if diffInt64Ptr(got.BalanceRappen, tt.wantBalanceRappen) {
				t.Errorf("EvaluateAccess(...).BalanceRappen = %v, want %v", got.BalanceRappen, tt.wantBalanceRappen)
			}
			if diffInt64Ptr(got.EstimatedCostRappen, tt.wantEstimatedRappen) {
				t.Errorf("EvaluateAccess(...).EstimatedCostRappen = %v, want %v", got.EstimatedCostRappen, tt.wantEstimatedRappen)
			}
			if got.NextStep != "subscribe" {
				t.Errorf("EvaluateAccess(...).NextStep = %q, want %q", got.NextStep, "subscribe")
			}
		})
	}
}

func diffInt64Ptr(got, want *int64) bool {
	if got == nil || want == nil {
		return got != want
	}
	return *got != *want
}

func TestCeilRappenFromMicro(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		micro int64
		want  int64
	}{
		{name: "zero is zero", micro: 0, want: 0},
		{name: "negative clamps to zero", micro: -5, want: 0},
		{name: "one micro rounds up to one rappen", micro: 1, want: 1},
		{name: "sub-rappen turn rounds up to one rappen", micro: 125_611, want: 1},
		{name: "exactly one rappen", micro: 1_000_000, want: 1},
		{name: "just over one rappen rounds up", micro: 1_000_001, want: 2},
		{name: "session total rounds up", micro: 12_561_100, want: 13},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := CeilRappenFromMicro(tt.micro); got != tt.want {
				t.Errorf("CeilRappenFromMicro(%d) = %d, want %d", tt.micro, got, tt.want)
			}
		})
	}
}

func TestFloorRappenFromMicro(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		micro int64
		want  int64
	}{
		{name: "zero is zero", micro: 0, want: 0},
		{name: "negative clamps to zero", micro: -5, want: 0},
		{name: "sub-rappen remainder floors to zero", micro: 999_999, want: 0},
		{name: "exactly one rappen", micro: 1_000_000, want: 1},
		{name: "remaining trial balance floors down", micro: 199_874_389, want: 199},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := FloorRappenFromMicro(tt.micro); got != tt.want {
				t.Errorf("FloorRappenFromMicro(%d) = %d, want %d", tt.micro, got, tt.want)
			}
		})
	}
}

func TestNewServiceWithMargin(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		marginBPS int64
		want      int64
	}{
		{name: "custom margin honoured", marginBPS: 3000, want: 3000},
		{name: "zero falls back to default", marginBPS: 0, want: DefaultMarginBPS},
		{name: "negative falls back to default", marginBPS: -100, want: DefaultMarginBPS},
		{name: "default constructor is 22%", marginBPS: DefaultMarginBPS, want: 2200},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := NewServiceWithMargin(tt.marginBPS); got.MarginBPS != tt.want {
				t.Errorf("NewServiceWithMargin(%d).MarginBPS = %d, want %d", tt.marginBPS, got.MarginBPS, tt.want)
			}
		})
	}
}
