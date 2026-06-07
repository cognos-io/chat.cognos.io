package billing

import (
	"testing"
	"time"
)

func TestDefaultTrialStateSeedUsesDefaultWhenSeedUnset(t *testing.T) {
	t.Parallel()

	at := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)
	got := DefaultTrialStateSeed(at, 0)

	if got.PlanType != PlanTypeTrial {
		t.Errorf("DefaultTrialStateSeed(...).PlanType = %q, want %q", got.PlanType, PlanTypeTrial)
	}
	if got.BalanceRappen != DefaultTrialSeedRappen {
		t.Errorf("DefaultTrialStateSeed(...).BalanceRappen = %d, want %d", got.BalanceRappen, DefaultTrialSeedRappen)
	}
	if got.TrialSeedGrantedRappen != DefaultTrialSeedRappen {
		t.Errorf("DefaultTrialStateSeed(...).TrialSeedGrantedRappen = %d, want %d", got.TrialSeedGrantedRappen, DefaultTrialSeedRappen)
	}
	if !got.PlanStartedAt.Equal(at) {
		t.Errorf("DefaultTrialStateSeed(...).PlanStartedAt = %v, want %v", got.PlanStartedAt, at)
	}
}

func TestDefaultTrialStateSeedUsesExplicitSeed(t *testing.T) {
	t.Parallel()

	at := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)
	got := DefaultTrialStateSeed(at, 321)

	if got.BalanceRappen != 321 {
		t.Errorf("DefaultTrialStateSeed(...).BalanceRappen = %d, want %d", got.BalanceRappen, 321)
	}
	if got.TrialSeedGrantedRappen != 321 {
		t.Errorf("DefaultTrialStateSeed(...).TrialSeedGrantedRappen = %d, want %d", got.TrialSeedGrantedRappen, 321)
	}
}
