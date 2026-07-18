package billing

import "testing"

// Org-attributed usage records the acting Account (user) AND the paying
// Organisation, meters like personal PAYG (negative accrual toward the pooled
// cycle), and never carries a balance-after — orgs have no balance to deplete
// (spec docs/specs/organisations.md §6.5).
func TestBuildUsageRecordCarriesOrgAttribution(t *testing.T) {
	t.Parallel()

	service := NewService()
	cost := service.CalculateCost(catalogueModelForLedgerTest(), Usage{
		InputTokens:  10,
		OutputTokens: 5,
	}, 1)

	got := service.BuildUsageRecord(State{PlanType: PlanTypePayG}, BuildUsageRecordInput{
		UserID:         "user-1",
		OrganisationID: "org-1",
		EventID:        "evt-org-1",
		ModelID:        "llama-3-3-infomaniak",
		Cost:           cost,
		FXRateUSDCHF:   1,
		InputTokens:    10,
		OutputTokens:   5,
	})

	if got.OrganisationID != "org-1" {
		t.Errorf("OrganisationID = %q, want %q", got.OrganisationID, "org-1")
	}
	if got.UserID != "user-1" {
		t.Errorf("UserID = %q, want the acting Account kept for audit", got.UserID)
	}
	if got.PlanType != PlanTypePayG {
		t.Errorf("PlanType = %q, want %q", got.PlanType, PlanTypePayG)
	}
	if got.AmountMicroRappen != -cost.CostMicroRappen {
		t.Errorf("AmountMicroRappen = %d, want %d (accrues toward the pooled cycle)", got.AmountMicroRappen, -cost.CostMicroRappen)
	}
	if got.BalanceAfterRappen != nil || got.BalanceAfterMicroRappen != nil {
		t.Error("BalanceAfter* set for an org record, want nil — orgs have no balance")
	}
}

func TestBuildUsageRecordLeavesOrganisationEmptyForPersonalUsage(t *testing.T) {
	t.Parallel()

	service := NewService()
	cost := service.CalculateCost(catalogueModelForLedgerTest(), Usage{InputTokens: 10, OutputTokens: 5}, 1)

	got := service.BuildUsageRecord(State{PlanType: PlanTypeTrial, BalanceMicroRappen: 5_000_000_000}, BuildUsageRecordInput{
		UserID:       "user-1",
		EventID:      "evt-1",
		ModelID:      "llama-3-3-infomaniak",
		Cost:         cost,
		FXRateUSDCHF: 1,
	})

	if got.OrganisationID != "" {
		t.Errorf("OrganisationID = %q, want empty for personal usage", got.OrganisationID)
	}
	if got.BalanceAfterMicroRappen == nil {
		t.Error("BalanceAfterMicroRappen = nil, want trial balance projection preserved")
	}
}
