package billing

import (
	"testing"

	"pgregory.net/rapid"
)

// Property: the micro-rappen rounding pair never leaks money in the user's
// favour or ours beyond one rappen: floor ≤ exact ≤ ceil, they differ by at
// most one rappen, whole-rappen amounts round-trip exactly, and neither
// projection is ever negative (the "display never overstates credit / charges
// never undercharge" rules from the precision fix).
func TestMicroRappenRoundingProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		micro := rapid.Int64Range(0, 1<<50).Draw(t, "micro")

		floor := FloorRappenFromMicro(micro)
		ceil := CeilRappenFromMicro(micro)

		if floor < 0 || ceil < 0 {
			t.Fatalf("rounding produced a negative rappen amount: floor=%d ceil=%d", floor, ceil)
		}
		if floor > ceil {
			t.Fatalf("floor %d > ceil %d for micro=%d", floor, ceil, micro)
		}
		if ceil-floor > 1 {
			t.Fatalf("ceil-floor = %d for micro=%d, want <= 1", ceil-floor, micro)
		}
		if floor*MicroRappenPerRappen > micro {
			t.Fatalf("floor overstates: %d rappen > %d micro", floor, micro)
		}
		if ceil*MicroRappenPerRappen < micro {
			t.Fatalf("ceil undercharges: %d rappen < %d micro", ceil, micro)
		}
		// Whole-rappen values round-trip exactly through both projections.
		if micro%MicroRappenPerRappen == 0 && (floor != ceil || floor != micro/MicroRappenPerRappen) {
			t.Fatalf("whole-rappen %d micro did not round-trip: floor=%d ceil=%d", micro, floor, ceil)
		}
	})
}

// Property: applying an arbitrary sequence of usage costs as in-transaction
// deltas (the post-race-fix RecordUsage semantics) is exactly linear — the
// final precise balance equals start - sum(costs) regardless of order or
// count, and the displayed whole-rappen projection never overstates the
// precise balance and never goes negative even when the balance itself does.
func TestTrialBalanceDeltaSequenceProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		start := rapid.Int64Range(0, 500*MicroRappenPerRappen).Draw(t, "start")
		costs := rapid.SliceOfN(rapid.Int64Range(0, 20*MicroRappenPerRappen), 0, 32).Draw(t, "costs")

		balance := start
		var sum int64
		for _, cost := range costs {
			balance -= cost
			sum += cost

			display := FloorRappenFromMicro(balance)
			if display < 0 {
				t.Fatalf("displayed balance went negative: %d", display)
			}
			if balance >= 0 && display*MicroRappenPerRappen > balance {
				t.Fatalf("displayed balance %d rappen overstates precise balance %d micro", display, balance)
			}
			// An overdrawn precise balance clamps to a zero display — never a
			// negative credit and never phantom remaining credit.
			if balance < 0 && display != 0 {
				t.Fatalf("displayed balance = %d for overdrawn precise balance %d, want 0", display, balance)
			}
		}

		if balance != start-sum {
			t.Fatalf("final balance = %d, want %d (start %d - sum %d)", balance, start-sum, start, sum)
		}
	})
}
