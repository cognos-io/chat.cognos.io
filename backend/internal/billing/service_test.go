package billing

import (
	"math"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
)

func TestCalculateCostUsesProviderCostWhenAvailable(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.1234
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

	if diff := math.Abs(got.CostUSD - providerCostUSD); diff > 1e-9 {
		t.Errorf("CalculateCost(...).CostUSD = %f, want %f", got.CostUSD, providerCostUSD)
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

	wantUSD := 1.0
	wantCHF := 0.9
	wantRappen := int64(90)

	if diff := math.Abs(got.CostUSD - wantUSD); diff > 1e-9 {
		t.Errorf("CalculateCost(...).CostUSD = %f, want %f", got.CostUSD, wantUSD)
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
	if got.CostRappen != 11 {
		t.Errorf("CalculateCost(...).CostRappen = %d, want %d", got.CostRappen, 11)
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
