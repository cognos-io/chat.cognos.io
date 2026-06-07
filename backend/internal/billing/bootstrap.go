package billing

import "time"

const DefaultTrialSeedRappen int64 = 200

type TrialStateSeed struct {
	PlanType               PlanType
	BalanceRappen          int64
	TrialSeedGrantedRappen int64
	PlanStartedAt          time.Time
}

func DefaultTrialStateSeed(now time.Time, seedRappen int64) TrialStateSeed {
	if seedRappen <= 0 {
		seedRappen = DefaultTrialSeedRappen
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}

	return TrialStateSeed{
		PlanType:               PlanTypeTrial,
		BalanceRappen:          seedRappen,
		TrialSeedGrantedRappen: seedRappen,
		PlanStartedAt:          now.UTC(),
	}
}
