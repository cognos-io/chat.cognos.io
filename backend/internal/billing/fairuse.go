package billing

import (
	"time"

	"github.com/pocketbase/dbx"
)

// DefaultFairUseAlertRappen is the rolling-30-day user-cost at which an
// Unlimited Account is flagged for operator review. Monitoring never silently
// blocks an Account; the response procedure defines the human decision.
const DefaultFairUseAlertRappen = 20000

// DefaultFairUseWindow is the rolling window the rollup sums over.
const DefaultFairUseWindow = 30 * 24 * time.Hour

// FairUseFlag is an Unlimited user whose rolling user-cost crossed the
// threshold — surfaced to operators, never used to block the user.
type FairUseFlag struct {
	UserID            string
	RollingCostRappen int64
	RequestCount      int64
}

// FlagFairUseOutliers returns Unlimited users whose `usage` user-cost over
// [since, now) exceeds thresholdRappen, highest first. Read-only: it never
// writes or limits anything (spec §8.1 — monitor only). Sums the
// authoritative `balance_transactions` ledger directly; the spec's DuckDB /
// parquet rollup is the analytics-scale alternative for later.
func (r *PocketBaseRepo) FlagFairUseOutliers(since time.Time, thresholdRappen int64) ([]FairUseFlag, error) {
	type row struct {
		UserID string `db:"user_id"`
		Count  int64  `db:"cnt"`
		Cost   int64  `db:"cost"`
	}

	var rows []row
	err := r.app.DB().
		NewQuery(`
			SELECT user_id,
			       COUNT(*) AS cnt,
			       COALESCE(SUM(user_cost_microrappen), 0) AS cost
			FROM ` + balanceTransactionsCollectionName + `
			WHERE type = {:type}
			  AND plan_type = {:plan}
			  AND occurred_at >= {:since}
			GROUP BY user_id
			HAVING SUM(user_cost_microrappen) >= {:threshold}
			ORDER BY cost DESC
		`).
		Bind(dbx.Params{
			"type":      UsageTransactionType,
			"plan":      string(PlanTypeUnlimited),
			"since":     since.UTC().Format(pbDateLayout),
			"threshold": thresholdRappen * MicroRappenPerRappen,
		}).
		All(&rows)
	if err != nil {
		return nil, err
	}

	flags := make([]FairUseFlag, 0, len(rows))
	for _, row := range rows {
		flags = append(flags, FairUseFlag{
			UserID:            row.UserID,
			RollingCostRappen: CeilRappenFromMicro(row.Cost),
			RequestCount:      row.Count,
		})
	}
	return flags, nil
}
