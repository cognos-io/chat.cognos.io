package billing

import (
	"math"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
)

func TestCalculateCostUsesProviderCostWhenAvailable(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.1234
	wantUserCostUSD := providerCostUSD * 1.2
	service := NewService()
	model, ok := catalogue.GetModelByID("llama-3-3-infomaniak")
	if !ok {
		t.Fatal("GetModelByID(llama-3-3-infomaniak) ok = false, want true")
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
	wantUserUSD := 1.2
	wantCHF := 1.08
	wantRappen := int64(108)

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
	wantUserUSD := wantProviderUSD * 1.2
	wantRappen := int64(17)

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
		name                string
		state               State
		estimatedCostRappen int64
		wantError           string
		wantMessage         string
		wantBalanceRappen   *int64
		wantEstimatedRappen *int64
	}{
		{
			name:        "inactive users must subscribe",
			state:       State{PlanType: PlanTypeInactive},
			wantError:   "INACTIVE",
			wantMessage: "Choose a plan to keep chatting.",
		},
		{
			name:                "trial users are blocked when balance is too low",
			state:               State{PlanType: PlanTypeTrial, BalanceRappen: 2},
			estimatedCostRappen: 32,
			wantError:           "TRIAL_EXHAUSTED",
			wantMessage:         "Your free trial has been used up.",
			wantBalanceRappen:   int64Ptr(2),
			wantEstimatedRappen: int64Ptr(32),
		},
		{
			name:                "trial users can continue when balance covers the estimate",
			state:               State{PlanType: PlanTypeTrial, BalanceRappen: 32},
			estimatedCostRappen: 32,
		},
		{
			name:                "payg users are not blocked for funds",
			state:               State{PlanType: PlanTypePayG, BalanceRappen: 0},
			estimatedCostRappen: 320,
		},
		{
			name:                "unlimited users are not blocked for funds",
			state:               State{PlanType: PlanTypeUnlimited, BalanceRappen: 0},
			estimatedCostRappen: 320,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := service.EvaluateAccess(tt.state, tt.estimatedCostRappen)
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
