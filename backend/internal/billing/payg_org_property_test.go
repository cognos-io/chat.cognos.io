package billing

import "testing"

import "pgregory.net/rapid"

// Property: ComputeOrgCycleSummary pins the pooled PAYG settlement contract
// (docs/business_processes/organisation-lifecycle.md). For every usage/seats/commit
// combination: nothing is ever negative, the pooled floor is seats x commit,
// overage + floor == expected bill (i.e. the recurring seat charge plus the
// one-time overage always reconstructs the invoice exactly), and the bill is
// monotonic in usage — more usage can never shrink an Organisation's bill.
func TestComputeOrgCycleSummaryProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		usage := rapid.Int64Range(-10_000_000, 10_000_000_000).Draw(t, "usage")
		seats := rapid.Int64Range(-10, 100_000).Draw(t, "seats")
		commit := rapid.Int64Range(-10_000, 1_000_000).Draw(t, "commit")

		got := ComputeOrgCycleSummary(usage, seats, commit)

		if got.PooledUsageRappen < 0 {
			t.Fatalf("PooledUsageRappen = %d, want >= 0", got.PooledUsageRappen)
		}
		if got.SeatQuantity < 0 {
			t.Fatalf("SeatQuantity = %d, want >= 0", got.SeatQuantity)
		}
		if got.OverageChargeRappen < 0 {
			t.Fatalf("OverageChargeRappen = %d, want >= 0", got.OverageChargeRappen)
		}
		if got.LocalExpectedBillRappen < 0 {
			t.Fatalf("LocalExpectedBillRappen = %d, want >= 0", got.LocalExpectedBillRappen)
		}

		wantCommit := commit
		if wantCommit < 0 {
			wantCommit = 0
		}
		floor := got.SeatQuantity * wantCommit

		// The recurring seat charge (floor) plus the one-time overage must
		// reconstruct the expected bill exactly — no rounding drift, no gap.
		if got.OverageChargeRappen+floor != got.LocalExpectedBillRappen {
			t.Fatalf(
				"overage(%d) + floor(%d) = %d, want expected bill %d",
				got.OverageChargeRappen, floor,
				got.OverageChargeRappen+floor, got.LocalExpectedBillRappen,
			)
		}

		// The bill is max(usage, floor): never below either component.
		if got.LocalExpectedBillRappen < got.PooledUsageRappen || got.LocalExpectedBillRappen < floor {
			t.Fatalf(
				"expected bill = %d, want at least usage=%d and floor=%d",
				got.LocalExpectedBillRappen, got.PooledUsageRappen, floor,
			)
		}

		// Monotonic in usage: adding usage can never shrink the bill or the
		// overage.
		delta := rapid.Int64Range(0, 1_000_000).Draw(t, "delta")
		more := ComputeOrgCycleSummary(usage+delta, seats, commit)
		if more.LocalExpectedBillRappen < got.LocalExpectedBillRappen {
			t.Fatalf(
				"bill(usage+%d) = %d < bill(usage) = %d, want monotonic",
				delta, more.LocalExpectedBillRappen, got.LocalExpectedBillRappen,
			)
		}
		if more.OverageChargeRappen < got.OverageChargeRappen {
			t.Fatalf(
				"overage(usage+%d) = %d < overage(usage) = %d, want monotonic",
				delta, more.OverageChargeRappen, got.OverageChargeRappen,
			)
		}
	})
}

// Property: the micro-rappen rounding invariants hold at the pooled level —
// summing member usage in micro-rappen and ceiling once (how the webhook
// slice will meter an org cycle) never undercharges relative to the exact
// pooled amount, overstates by less than one rappen, and ceiling the pooled
// sum never exceeds the sum of per-row ceilings (pooling can only merge
// sub-rappen remainders, never create new ones).
func TestOrgPooledUsageMicroRappenProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		rows := rapid.SliceOfN(rapid.Int64Range(0, 50_000_000_000), 0, 25).Draw(t, "rows")

		var pooledMicro int64
		var summedCeil int64
		for _, row := range rows {
			pooledMicro += row
			summedCeil += CeilRappenFromMicro(row)
		}

		pooledRappen := CeilRappenFromMicro(pooledMicro)

		// Never undercharge: the ceiled pooled charge covers the exact amount.
		if pooledRappen*MicroRappenPerRappen < pooledMicro {
			t.Fatalf(
				"CeilRappenFromMicro(%d) = %d rappen, undercharges the exact pooled amount",
				pooledMicro, pooledRappen,
			)
		}
		// Never overstate by a whole rappen or more.
		if pooledRappen*MicroRappenPerRappen-pooledMicro >= MicroRappenPerRappen {
			t.Fatalf(
				"CeilRappenFromMicro(%d) = %d rappen, overstates by a whole rappen",
				pooledMicro, pooledRappen,
			)
		}
		// Pooling before ceiling can only be kinder than ceiling per member.
		if pooledRappen > summedCeil {
			t.Fatalf(
				"pooled ceil = %d rappen > summed per-row ceil = %d rappen",
				pooledRappen, summedCeil,
			)
		}

		// The floored display projection never overstates: floor <= exact <= ceil.
		if FloorRappenFromMicro(pooledMicro) > pooledRappen {
			t.Fatalf(
				"FloorRappenFromMicro(%d) = %d > CeilRappenFromMicro = %d",
				pooledMicro, FloorRappenFromMicro(pooledMicro), pooledRappen,
			)
		}
	})
}
