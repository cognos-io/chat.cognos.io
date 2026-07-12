package billing

import "testing"

import "pgregory.net/rapid"

// Property: the access gate is consistent with the affordability check and the
// presentation fields use the documented rounding rules when a trial is
// actually exhausted. This pins the billing denial contract used by the UI.
func TestEvaluateAccessProperties(t *testing.T) {
	t.Parallel()

	service := NewService()

	rapid.Check(t, func(t *rapid.T) {
		plan := rapid.SampledFrom([]PlanType{
			PlanTypeInactive,
			PlanTypeTrial,
			PlanTypePayG,
			PlanTypeUnlimited,
		}).Draw(t, "plan")
		balanceMicro := rapid.Int64Range(0, 500_000_000).Draw(t, "balanceMicro")
		estimatedMicro := rapid.Int64Range(0, 500_000_000).Draw(t, "estimatedMicro")

		got := service.EvaluateAccess(State{
			PlanType:           plan,
			BalanceRappen:      FloorRappenFromMicro(balanceMicro),
			BalanceMicroRappen: balanceMicro,
		}, estimatedMicro)

		switch plan {
		case PlanTypeUnlimited:
			if got != nil {
				t.Fatalf("EvaluateAccess(unlimited, %d) = %#v, want nil", estimatedMicro, got)
			}
		case PlanTypeInactive:
			if got == nil {
				t.Fatalf("EvaluateAccess(inactive, %d) = nil, want restriction", estimatedMicro)
				return
			}
			if got.Error != "INACTIVE" || got.NextStep != "subscribe" {
				t.Fatalf("inactive restriction = %#v, want INACTIVE/subscribe", got)
			}
		case PlanTypePayG:
			if got != nil {
				t.Fatalf("EvaluateAccess(payg, %d) = %#v, want nil", estimatedMicro, got)
			}
		case PlanTypeTrial:
			wantRestricted := estimatedMicro > 0 && balanceMicro < estimatedMicro
			if !wantRestricted {
				if got != nil {
					t.Fatalf("EvaluateAccess(trial, affordable) = %#v, want nil", got)
				}
				return
			}
			if got == nil {
				t.Fatalf("EvaluateAccess(trial, unaffordable) = nil, want restriction")
				return
			}
			if got.Error != "TRIAL_EXHAUSTED" || got.NextStep != "subscribe" {
				t.Fatalf("trial restriction = %#v, want TRIAL_EXHAUSTED/subscribe", got)
			}
			wantBalance := FloorRappenFromMicro(balanceMicro)
			wantEstimate := CeilRappenFromMicro(estimatedMicro)
			if got.BalanceRappen == nil || *got.BalanceRappen != wantBalance {
				t.Fatalf("BalanceRappen = %v, want %d", got.BalanceRappen, wantBalance)
			}
			if got.EstimatedCostRappen == nil || *got.EstimatedCostRappen != wantEstimate {
				t.Fatalf("EstimatedCostRappen = %v, want %d", got.EstimatedCostRappen, wantEstimate)
			}
		}
	})
}
