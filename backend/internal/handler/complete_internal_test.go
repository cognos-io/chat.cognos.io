package handler

import (
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
)

type stubFXRateProvider struct {
	rate float64
}

func (s stubFXRateProvider) USDToCHF() float64 { return s.rate }

func TestCompletionUSDToCHFRateUsesProvider(t *testing.T) {
	t.Parallel()

	rate := completionUSDToCHFRate(CompleteHandlerParams{
		FXRateProvider: stubFXRateProvider{rate: 0.91},
	})
	if rate != 0.91 {
		t.Errorf("completionUSDToCHFRate = %f, want 0.91", rate)
	}
}

func TestCompletionUSDToCHFRateFallsBackToOneWhenProviderMissing(t *testing.T) {
	t.Parallel()

	if rate := completionUSDToCHFRate(CompleteHandlerParams{}); rate != 1 {
		t.Errorf("completionUSDToCHFRate without provider = %f, want 1", rate)
	}
}

func TestCompleteBillingRestrictionResponseCopiesPlainFields(t *testing.T) {
	t.Parallel()

	response := completeBillingRestrictionResponse(billing.AccessRestriction{
		Error:    "billing_blocked",
		Message:  "Top up your account",
		NextStep: "purchase_credit",
	}, 0)

	if response.Error != "billing_blocked" {
		t.Errorf("Error = %q, want %q", response.Error, "billing_blocked")
	}
	if response.Message != "Top up your account" {
		t.Errorf("Message = %q, want %q", response.Message, "Top up your account")
	}
	if response.NextStep != "purchase_credit" {
		t.Errorf("NextStep = %q, want %q", response.NextStep, "purchase_credit")
	}
	if response.BalanceCHF != nil {
		t.Errorf("BalanceCHF = %v, want nil when not provided", *response.BalanceCHF)
	}
	if response.EstimatedCostCHF != nil {
		t.Errorf("EstimatedCostCHF = %v, want nil when both inputs are zero", *response.EstimatedCostCHF)
	}
}

func TestCompleteBillingRestrictionResponseConvertsBalanceToCHF(t *testing.T) {
	t.Parallel()

	balance := int64(2_345) // 23.45 CHF in Rappen
	response := completeBillingRestrictionResponse(billing.AccessRestriction{
		BalanceRappen: &balance,
	}, 0)

	if response.BalanceCHF == nil {
		t.Fatalf("BalanceCHF = nil, want 23.45")
	}
	if *response.BalanceCHF != 23.45 {
		t.Errorf("BalanceCHF = %f, want 23.45", *response.BalanceCHF)
	}
}

func TestCompleteBillingRestrictionResponsePrefersRestrictionEstimatedCost(t *testing.T) {
	t.Parallel()

	estimate := int64(500) // 5 CHF
	response := completeBillingRestrictionResponse(billing.AccessRestriction{
		EstimatedCostRappen: &estimate,
	}, 99.99)

	if response.EstimatedCostCHF == nil {
		t.Fatalf("EstimatedCostCHF = nil, want 5 from restriction (not the caller estimate)")
	}
	if *response.EstimatedCostCHF != 5 {
		t.Errorf("EstimatedCostCHF = %f, want 5", *response.EstimatedCostCHF)
	}
}

func TestCompleteBillingRestrictionResponseFallsBackToProvidedEstimate(t *testing.T) {
	t.Parallel()

	response := completeBillingRestrictionResponse(billing.AccessRestriction{}, 1.25)

	if response.EstimatedCostCHF == nil {
		t.Fatalf("EstimatedCostCHF = nil, want fallback 1.25")
	}
	if *response.EstimatedCostCHF != 1.25 {
		t.Errorf("EstimatedCostCHF = %f, want 1.25", *response.EstimatedCostCHF)
	}
}

func TestCompleteBillingRestrictionResponseLeavesEstimateUnsetWhenZeroFallback(t *testing.T) {
	t.Parallel()

	response := completeBillingRestrictionResponse(billing.AccessRestriction{}, 0)

	if response.EstimatedCostCHF != nil {
		t.Errorf("EstimatedCostCHF = %v, want nil when no restriction estimate and zero fallback", *response.EstimatedCostCHF)
	}
}
