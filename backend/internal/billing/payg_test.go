package billing

import "testing"

func TestComputeCycleSummary(t *testing.T) {
	t.Parallel()

	const commit = DefaultPAYGMinCommitRappen // 1000 = CHF 10.00

	tests := []struct {
		name         string
		usage        int64
		wantUsage    int64
		wantExpected int64
		wantOverage  int64
	}{
		{"no usage bills the floor", 0, 0, 1000, 0},
		{"under the commit bills the floor", 342, 342, 1000, 0},
		{"exactly the commit, no overage", 1000, 1000, 1000, 0},
		{"one rappen over bills one rappen overage", 1001, 1001, 1001, 1},
		{"well over the commit (CHF 23.40)", 2340, 2340, 2340, 1340},
		{"negative usage is clamped to the floor", -50, 0, 1000, 0},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := ComputeCycleSummary(tc.usage, commit)
			if got.LocalUsageRappen != tc.wantUsage {
				t.Errorf("LocalUsageRappen = %d, want %d", got.LocalUsageRappen, tc.wantUsage)
			}
			if got.LocalExpectedBillRappen != tc.wantExpected {
				t.Errorf("LocalExpectedBillRappen = %d, want %d", got.LocalExpectedBillRappen, tc.wantExpected)
			}
			if got.OverageChargeRappen != tc.wantOverage {
				t.Errorf("OverageChargeRappen = %d, want %d", got.OverageChargeRappen, tc.wantOverage)
			}
		})
	}
}
