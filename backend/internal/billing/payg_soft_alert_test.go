package billing

import (
	"testing"
	"time"
)

func TestEvaluatePAYGSoftAlert(t *testing.T) {
	t.Parallel()

	cycle := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	prevCycle := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	const commit = DefaultPAYGMinCommitRappen

	tests := []struct {
		name        string
		plan        PlanType
		usage       int64
		minCommit   int64
		cycleStart  time.Time
		alertedFor  time.Time
		wantShow    bool
		wantOverage int64
	}{
		{
			name:        "sunny: first overage this cycle shows",
			plan:        PlanTypePayG,
			usage:       2340,
			minCommit:   commit,
			cycleStart:  cycle,
			wantShow:    true,
			wantOverage: 840,
		},
		{
			name:        "sunny: exactly at the minimum shows (heads-up before overage)",
			plan:        PlanTypePayG,
			usage:       commit,
			minCommit:   commit,
			cycleStart:  cycle,
			wantShow:    true,
			wantOverage: 0,
		},
		{
			name:       "rainy: under the minimum stays quiet",
			plan:       PlanTypePayG,
			usage:      900,
			minCommit:  commit,
			cycleStart: cycle,
			wantShow:   false,
		},
		{
			name:        "rainy: already acknowledged this cycle stays quiet",
			plan:        PlanTypePayG,
			usage:       5000,
			minCommit:   commit,
			cycleStart:  cycle,
			alertedFor:  cycle,
			wantShow:    false,
			wantOverage: 3500,
		},
		{
			name:        "edge: acked previous cycle, over again this cycle shows",
			plan:        PlanTypePayG,
			usage:       2000,
			minCommit:   commit,
			cycleStart:  cycle,
			alertedFor:  prevCycle,
			wantShow:    true,
			wantOverage: 500,
		},
		{
			name:        "edge: unlimited never soft-alerts (fair-use is separate)",
			plan:        PlanTypeUnlimited,
			usage:       99_999,
			minCommit:   commit,
			cycleStart:  cycle,
			wantShow:    false,
			wantOverage: 99_999 - commit,
		},
		{
			name:        "edge: missing cycle start cannot claim one-per-cycle",
			plan:        PlanTypePayG,
			usage:       5000,
			minCommit:   commit,
			wantShow:    false,
			wantOverage: 3500,
		},
		{
			name:        "edge: zero/negative min commit never alerts",
			plan:        PlanTypePayG,
			usage:       5000,
			minCommit:   0,
			cycleStart:  cycle,
			wantShow:    false,
			wantOverage: 5000,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := EvaluatePAYGSoftAlert(tc.plan, tc.usage, tc.minCommit, tc.cycleStart, tc.alertedFor)
			if got.Show != tc.wantShow {
				t.Errorf("Show = %v, want %v", got.Show, tc.wantShow)
			}
			if got.OverageRappen != tc.wantOverage {
				t.Errorf("OverageRappen = %d, want %d", got.OverageRappen, tc.wantOverage)
			}
			if got.UsageRappen != max64(tc.usage, 0) {
				t.Errorf("UsageRappen = %d, want %d", got.UsageRappen, max64(tc.usage, 0))
			}
		})
	}
}

func TestUsageSummaryTotalCostMicroRappen(t *testing.T) {
	t.Parallel()
	summary := UsageSummary{ByModel: []ModelUsage{
		{CostMicroRappen: 1_400_000_000},
		{CostMicroRappen: 3_100_000_000},
	}}
	if got := summary.TotalCostMicroRappen(); got != 4_500_000_000 {
		t.Fatalf("TotalCostMicroRappen = %d, want 4500000000", got)
	}
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
