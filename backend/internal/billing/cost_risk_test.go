package billing

import "testing"

func TestBuildCostRiskReport(t *testing.T) {
	t.Parallel()

	report := BuildCostRiskReport([]AccountModelCost{
		{UserID: "account-a", ModelID: "model-fast", PlanType: PlanTypePayG, RequestCount: 4, ProviderCostMicroRappen: 10_000_000, UserCostMicroRappen: 12_200_000},
		{UserID: "account-b", ModelID: "model-fast", PlanType: PlanTypeUnlimited, RequestCount: 2, ProviderCostMicroRappen: 30_000_000, UserCostMicroRappen: 36_600_000},
		{UserID: "account-c", ModelID: "model-deep", PlanType: PlanTypePayG, RequestCount: 1, ProviderCostMicroRappen: 100_000_000, UserCostMicroRappen: 122_000_000},
		{UserID: "account-a", ModelID: "model-deep", PlanType: PlanTypeTrial, RequestCount: 1, ProviderCostMicroRappen: 20_000_000, UserCostMicroRappen: 24_400_000},
	})

	if report.AccountProviderCost.P50Rappen != 30 || report.AccountProviderCost.P95Rappen != 100 {
		t.Fatalf("account provider-cost percentiles = %+v, want p50=30 p95=100", report.AccountProviderCost)
	}
	if len(report.Models) != 2 {
		t.Fatalf("len(Models) = %d, want 2", len(report.Models))
	}

	deep := report.Models[0] // highest provider cost first
	if deep.ModelID != "model-deep" {
		t.Fatalf("first model = %q, want model-deep", deep.ModelID)
	}
	if deep.ProviderCostRappen != 120 {
		t.Errorf("model-deep ProviderCostRappen = %d, want 120", deep.ProviderCostRappen)
	}
	if deep.PAYGRevenueRappen != 122 || deep.PAYGGrossProfitRappen != 22 {
		t.Errorf("model-deep PAYG margin = revenue %d profit %d, want 122/22", deep.PAYGRevenueRappen, deep.PAYGGrossProfitRappen)
	}
	if deep.PAYGGrossMarginBPS != 1803 {
		t.Errorf("model-deep PAYGGrossMarginBPS = %d, want 1803", deep.PAYGGrossMarginBPS)
	}
	if deep.AccountProviderCost.P50Rappen != 20 || deep.AccountProviderCost.P95Rappen != 100 {
		t.Errorf("model-deep account percentiles = %+v, want p50=20 p95=100", deep.AccountProviderCost)
	}

	fast := report.Models[1]
	if fast.PAYGRevenueRappen != 12 || fast.PAYGGrossProfitRappen != 2 {
		t.Errorf("Unlimited shadow price leaked into PAYG revenue: revenue %d profit %d, want 12/2", fast.PAYGRevenueRappen, fast.PAYGGrossProfitRappen)
	}
}

func TestCostRiskLevel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		cost int64
		want CostRiskLevel
	}{
		{name: "below review", cost: 19_999, want: CostRiskNormal},
		{name: "review threshold", cost: 20_000, want: CostRiskReview},
		{name: "below shutdown review", cost: 44_999, want: CostRiskReview},
		{name: "shutdown review threshold", cost: 45_000, want: CostRiskShutdownReview},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := ClassifyCostRisk(tc.cost, 20_000, 45_000); got != tc.want {
				t.Errorf("ClassifyCostRisk(%d) = %q, want %q", tc.cost, got, tc.want)
			}
		})
	}
}

func TestBuildCostRiskReportEmpty(t *testing.T) {
	t.Parallel()

	report := BuildCostRiskReport(nil)
	if len(report.Models) != 0 || report.AccountProviderCost != (CostPercentiles{}) {
		t.Fatalf("empty report = %+v", report)
	}
}
