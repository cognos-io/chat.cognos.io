package billing

import "testing"

// ComputeOrgCycleSummary is the pooled-floor variant of ComputeCycleSummary
// (spec docs/specs/organisations.md §7.4): the Organisation pays
// max(pooled usage, seats x commit) per cycle, and only the part above the
// pooled floor is posted as a one-time overage charge.
func TestComputeOrgCycleSummary(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		usageRappen   int64
		seats         int64
		commitPerSeat int64
		wantBill      int64
		wantOverage   int64
	}{
		{
			name:        "usage below pooled floor bills the floor with no overage",
			usageRappen: 3000, seats: 3, commitPerSeat: 1500,
			wantBill: 4500, wantOverage: 0,
		},
		{
			name:        "usage above pooled floor bills usage and posts the difference",
			usageRappen: 5200, seats: 3, commitPerSeat: 1500,
			wantBill: 5200, wantOverage: 700,
		},
		{
			name:        "usage exactly at the pooled floor posts nothing",
			usageRappen: 4500, seats: 3, commitPerSeat: 1500,
			wantBill: 4500, wantOverage: 0,
		},
		{
			name:        "single seat matches the personal PAYG maths",
			usageRappen: 2340, seats: 1, commitPerSeat: 1500,
			wantBill: 2340, wantOverage: 840,
		},
		{
			name:        "zero usage still bills the pooled floor",
			usageRappen: 0, seats: 4, commitPerSeat: 1500,
			wantBill: 6000, wantOverage: 0,
		},
		{
			name:        "negative usage is clamped so a malformed ledger can never credit",
			usageRappen: -100, seats: 2, commitPerSeat: 1500,
			wantBill: 3000, wantOverage: 0,
		},
		{
			name:        "negative seats are clamped to a zero floor",
			usageRappen: 800, seats: -3, commitPerSeat: 1500,
			wantBill: 800, wantOverage: 800,
		},
		{
			name:        "zero seats means the whole usage is overage",
			usageRappen: 800, seats: 0, commitPerSeat: 1500,
			wantBill: 800, wantOverage: 800,
		},
		{
			name:        "negative commit is clamped to a zero floor",
			usageRappen: 800, seats: 2, commitPerSeat: -1,
			wantBill: 800, wantOverage: 800,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := ComputeOrgCycleSummary(tt.usageRappen, tt.seats, tt.commitPerSeat)

			if got.LocalExpectedBillRappen != tt.wantBill {
				t.Errorf("LocalExpectedBillRappen = %d, want %d", got.LocalExpectedBillRappen, tt.wantBill)
			}
			if got.OverageChargeRappen != tt.wantOverage {
				t.Errorf("OverageChargeRappen = %d, want %d", got.OverageChargeRappen, tt.wantOverage)
			}
			wantUsage := tt.usageRappen
			if wantUsage < 0 {
				wantUsage = 0
			}
			if got.PooledUsageRappen != wantUsage {
				t.Errorf("PooledUsageRappen = %d, want %d", got.PooledUsageRappen, wantUsage)
			}
			wantSeats := tt.seats
			if wantSeats < 0 {
				wantSeats = 0
			}
			if got.SeatQuantity != wantSeats {
				t.Errorf("SeatQuantity = %d, want %d", got.SeatQuantity, wantSeats)
			}
		})
	}
}
