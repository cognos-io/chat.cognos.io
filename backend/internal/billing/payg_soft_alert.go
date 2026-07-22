package billing

import "time"

// SoftAlert is the one-per-cycle PAYG heads-up when cycle usage reaches the
// monthly minimum. Informational only — EvaluateAccess must never consult it,
// and Completions must never be blocked because of it (OP-014).
type SoftAlert struct {
	Show            bool
	UsageRappen     int64
	MinCommitRappen int64
	OverageRappen   int64
}

// EvaluatePAYGSoftAlert decides whether to surface the soft warning for this
// Account's current cycle.
//
// Rules:
//   - PAYG only (trial / unlimited / inactive never alert).
//   - Usage must have reached the minimum commit (≥, including exact equality).
//   - A non-zero cycle start is required so "one per cycle" is well-defined.
//   - If alertedForCycleStart equals the current cycle start, the Account
//     already acknowledged this cycle — stay quiet until the next cycle.
func EvaluatePAYGSoftAlert(
	plan PlanType,
	usageRappen, minCommitRappen int64,
	cycleStart, alertedForCycleStart time.Time,
) SoftAlert {
	if usageRappen < 0 {
		usageRappen = 0
	}
	if minCommitRappen < 0 {
		minCommitRappen = 0
	}

	overage := usageRappen - minCommitRappen
	if overage < 0 {
		overage = 0
	}

	alert := SoftAlert{
		UsageRappen:     usageRappen,
		MinCommitRappen: minCommitRappen,
		OverageRappen:   overage,
	}

	if plan != PlanTypePayG {
		return alert
	}
	if minCommitRappen <= 0 || cycleStart.IsZero() {
		return alert
	}
	if usageRappen < minCommitRappen {
		return alert
	}
	if !alertedForCycleStart.IsZero() && alertedForCycleStart.Equal(cycleStart.UTC()) {
		return alert
	}

	alert.Show = true
	return alert
}

// TotalCostMicroRappen sums the per-model ledger costs in a usage summary.
func (s UsageSummary) TotalCostMicroRappen() int64 {
	var total int64
	for _, model := range s.ByModel {
		total += model.CostMicroRappen
	}
	return total
}
