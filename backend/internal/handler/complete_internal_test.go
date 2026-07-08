package handler

import (
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
)

func TestReasoningBudgetTokens(t *testing.T) {
	t.Parallel()

	cases := []struct {
		effort string
		want   int
	}{
		{effort: "", want: 0},
		{effort: "off", want: 0},
		{effort: "none", want: 0},
		{effort: "  OFF ", want: 0},
		{effort: "low", want: 4096},
		{effort: "minimal", want: 4096},
		{effort: "medium", want: 8192},
		{effort: "high", want: 16384},
		{effort: "unknown-tier", want: 8192},
	}

	for _, tc := range cases {
		t.Run(tc.effort, func(t *testing.T) {
			t.Parallel()
			if got := reasoningBudgetTokens(tc.effort); got != tc.want {
				t.Errorf("reasoningBudgetTokens(%q) = %d, want %d", tc.effort, got, tc.want)
			}
		})
	}
}

func TestReasoningOutputPlan(t *testing.T) {
	t.Parallel()

	model := catalogue.Model{MaxOutputTokens: 64000}
	smallModel := catalogue.Model{MaxOutputTokens: 6000}

	cases := []struct {
		name            string
		requested       int
		model           catalogue.Model
		plan            billing.PlanType
		effort          string
		wantMaxOutput   int
		wantBudget      int
		wantInvariant   bool // budget must sit strictly below maxOutput
		wantNoReasoning bool
	}{
		{
			name:            "reasoning off keeps the trial default ceiling",
			model:           model,
			plan:            billing.PlanTypeTrial,
			effort:          "off",
			wantMaxOutput:   8192,
			wantBudget:      0,
			wantNoReasoning: true,
		},
		{
			name:          "trial high effort raises ceiling above the budget",
			model:         model,
			plan:          billing.PlanTypeTrial,
			effort:        "high",
			wantMaxOutput: 16384 + reasoningAnswerHeadroomTokens, // 20480, well above the 8192 trial cap
			wantBudget:    16384,
			wantInvariant: true,
		},
		{
			name:          "paid medium effort fits within the higher ceiling",
			model:         model,
			plan:          billing.PlanTypePayG,
			effort:        "medium",
			wantMaxOutput: 32768, // paid cap already exceeds 8192+headroom
			wantBudget:    8192,
			wantInvariant: true,
		},
		{
			name:          "explicit request is honoured when it already clears the budget",
			requested:     40000,
			model:         model,
			plan:          billing.PlanTypeTrial,
			effort:        "high",
			wantMaxOutput: 40000,
			wantBudget:    16384,
			wantInvariant: true,
		},
		{
			name:          "tiny model ceiling shrinks the budget but keeps the invariant",
			model:         smallModel,
			plan:          billing.PlanTypeTrial,
			effort:        "high",
			wantMaxOutput: 6000,
			wantBudget:    6000 - reasoningAnswerHeadroomTokens, // 1904
			wantInvariant: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			gotMax, gotBudget := reasoningOutputPlan(tc.requested, tc.model, tc.plan, tc.effort)
			if gotMax != tc.wantMaxOutput {
				t.Errorf("maxOutput = %d, want %d", gotMax, tc.wantMaxOutput)
			}
			if gotBudget != tc.wantBudget {
				t.Errorf("budget = %d, want %d", gotBudget, tc.wantBudget)
			}
			if tc.wantNoReasoning && gotBudget != 0 {
				t.Errorf("budget = %d, want 0 when reasoning is off", gotBudget)
			}
			if tc.wantInvariant && gotBudget >= gotMax {
				t.Errorf("budget %d must be strictly below maxOutput %d (Anthropic invariant)", gotBudget, gotMax)
			}
		})
	}
}

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

func TestServedModelSnapshot(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name  string
		model catalogue.Model
		want  chat.ServedModel
	}{
		{
			name: "fully populated ch_only model",
			model: catalogue.Model{
				ID:             "apertus-70b-swiss",
				Name:           "Apertus 70B (Infomaniak)",
				ProviderID:     "infomaniak",
				ProviderName:   "Infomaniak",
				PrivacyTier:    catalogue.PrivacyTierCHOnly,
				HostingCountry: "CH",
				HostingRegion:  "Switzerland",
			},
			want: chat.ServedModel{
				ServedModelName:      "Apertus 70B (Infomaniak)",
				ServedProviderName:   "Infomaniak",
				ServedProviderID:     "infomaniak",
				ServedPrivacyTier:    "ch_only",
				ServedHostingCountry: "CH",
				ServedHostingRegion:  "Switzerland",
			},
		},
		{
			name: "eu model without hosting metadata",
			model: catalogue.Model{
				ID:           "some-eu-model",
				Name:         "Some EU Model",
				ProviderID:   "requesty",
				ProviderName: "Requesty",
				PrivacyTier:  catalogue.PrivacyTierEU,
			},
			want: chat.ServedModel{
				ServedModelName:    "Some EU Model",
				ServedProviderName: "Requesty",
				ServedProviderID:   "requesty",
				ServedPrivacyTier:  "eu",
			},
		},
		{
			name:  "empty model yields empty snapshot",
			model: catalogue.Model{},
			want:  chat.ServedModel{},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := servedModelSnapshot(tc.model); got != tc.want {
				t.Errorf("servedModelSnapshot(%+v) = %+v, want %+v", tc.model, got, tc.want)
			}
		})
	}
}
