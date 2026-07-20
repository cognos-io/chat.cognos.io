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

// OrgCycleSummary is the locally-computed view of a closed pooled org cycle
// (spec docs/specs/organisations.md §7.4): total org-attributed usage, the
// billed seat count, what we expect Paddle to invoice, and the one-time
// overage above the pooled floor.
type OrgCycleSummary struct {
	// PooledUsageRappen is the org-attributed cost of all usage in the cycle.
	PooledUsageRappen int64
	// SeatQuantity is the number of billed Seats for the cycle (the N of the
	// pooled floor N x commit).
	SeatQuantity int64
	// LocalExpectedBillRappen is max(usage, seats x commit) — what Paddle
	// should bill in total across the recurring seat charge and the overage.
	LocalExpectedBillRappen int64
	// OverageChargeRappen is max(0, usage - seats x commit) — the one-time
	// charge. The pooled floor is prepaid by the seat subscription, so
	// overage + floor always reconstructs the expected bill exactly.
	OverageChargeRappen int64
}

// ComputeOrgCycleSummary derives the pooled org cycle bill: the floor is
// seatQuantity x commitPerSeatRappen (one CHF 15 commit per Seat, pooled —
// NOT per-seat floors), the invoice is max(usage, floor) and only the part
// above the floor is posted as a one-time charge. Negative inputs are clamped
// to zero so a malformed ledger or seat count can never produce a credit.
func ComputeOrgCycleSummary(pooledUsageRappen, seatQuantity, commitPerSeatRappen int64) OrgCycleSummary {
	if seatQuantity < 0 {
		seatQuantity = 0
	}
	if commitPerSeatRappen < 0 {
		commitPerSeatRappen = 0
	}

	pooled := ComputeCycleSummary(pooledUsageRappen, seatQuantity*commitPerSeatRappen)

	return OrgCycleSummary{
		PooledUsageRappen:       pooled.LocalUsageRappen,
		SeatQuantity:            seatQuantity,
		LocalExpectedBillRappen: pooled.LocalExpectedBillRappen,
		OverageChargeRappen:     pooled.OverageChargeRappen,
	}
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
