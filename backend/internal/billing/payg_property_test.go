package billing

import "testing"

import "pgregory.net/rapid"

// Property: ComputeCycleSummary clamps malformed inputs to zero and preserves
// the contract max(usage, commit) for the expected bill while never producing a
// negative overage. This pins the PAYG cycle math used to reconcile Paddle
// invoices against local usage.
func TestComputeCycleSummaryProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		usage := rapid.Int64Range(-10_000_000, 10_000_000_000).Draw(t, "usage")
		commit := rapid.Int64Range(-10_000_000, 10_000_000_000).Draw(t, "commit")

		got := ComputeCycleSummary(usage, commit)

		if got.LocalUsageRappen < 0 {
			t.Fatalf("LocalUsageRappen = %d, want >= 0", got.LocalUsageRappen)
		}
		if got.LocalExpectedBillRappen < 0 {
			t.Fatalf("LocalExpectedBillRappen = %d, want >= 0", got.LocalExpectedBillRappen)
		}
		if got.OverageChargeRappen < 0 {
			t.Fatalf("OverageChargeRappen = %d, want >= 0", got.OverageChargeRappen)
		}

		wantUsage := usage
		if wantUsage < 0 {
			wantUsage = 0
		}
		wantCommit := commit
		if wantCommit < 0 {
			wantCommit = 0
		}
		wantExpected := wantUsage
		if wantExpected < wantCommit {
			wantExpected = wantCommit
		}
		wantOverage := wantUsage - wantCommit
		if wantOverage < 0 {
			wantOverage = 0
		}

		if got.LocalUsageRappen != wantUsage {
			t.Fatalf("LocalUsageRappen = %d, want %d", got.LocalUsageRappen, wantUsage)
		}
		if got.LocalExpectedBillRappen != wantExpected {
			t.Fatalf("LocalExpectedBillRappen = %d, want %d", got.LocalExpectedBillRappen, wantExpected)
		}
		if got.OverageChargeRappen != wantOverage {
			t.Fatalf("OverageChargeRappen = %d, want %d", got.OverageChargeRappen, wantOverage)
		}
		if got.LocalExpectedBillRappen < got.LocalUsageRappen || got.LocalExpectedBillRappen < wantCommit {
			t.Fatalf("expected bill = %d, want floor at least usage=%d and commit=%d", got.LocalExpectedBillRappen, got.LocalUsageRappen, wantCommit)
		}
	})
}
