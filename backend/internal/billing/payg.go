package billing

// DefaultPAYGMinCommitRappen is the CHF 15.00 minimum commit billed per PAYG
// cycle (spec §4.4, BILLING_PAYG_MIN_COMMIT_RAPPEN). It must match the
// cognos-payg Paddle price. Usage above this is posted as a one-time overage
// charge at cycle end.
const DefaultPAYGMinCommitRappen = 1500

// CycleSummary is the locally-computed view of a closed PAYG cycle: what the
// user actually used, what we therefore expect Paddle to bill, and the overage
// (above the minimum commit) we must post as a one-time charge.
type CycleSummary struct {
	// LocalUsageRappen is the user-facing cost of all usage in the cycle.
	LocalUsageRappen int64
	// LocalExpectedBillRappen is max(usage, commit) — what Paddle should bill.
	LocalExpectedBillRappen int64
	// OverageChargeRappen is max(0, usage - commit) — the one-time charge.
	OverageChargeRappen int64
}

// ComputeCycleSummary derives the cycle bill from local usage and the minimum
// commit. The commit is pre-paid by the recurring price, so we only ever post
// the overage above it; the net invoice is max(usage, commit). Negative inputs
// are clamped to zero so a malformed ledger can never produce a credit.
func ComputeCycleSummary(usageRappen, minCommitRappen int64) CycleSummary {
	if usageRappen < 0 {
		usageRappen = 0
	}
	if minCommitRappen < 0 {
		minCommitRappen = 0
	}

	expected := usageRappen
	if expected < minCommitRappen {
		expected = minCommitRappen
	}

	overage := usageRappen - minCommitRappen
	if overage < 0 {
		overage = 0
	}

	return CycleSummary{
		LocalUsageRappen:        usageRappen,
		LocalExpectedBillRappen: expected,
		OverageChargeRappen:     overage,
	}
}
