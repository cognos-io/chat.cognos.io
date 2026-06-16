package billing

import (
	"time"

	"github.com/pocketbase/dbx"
)

// DefaultFairUseAlertRappen is the rolling-30-day user-cost above which an
// Unlimited account is flagged for operator review (spec §4.4,
// BILLING_UNLIMITED_FAIR_USE_ALERT_CHF = CHF 200.00 = 2× the monthly price).
// Monitoring only — never an automated block (spec §8.1).
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
			       COALESCE(SUM(user_cost_rappen), 0) AS cost
			FROM ` + balanceTransactionsCollectionName + `
			WHERE type = {:type}
			  AND plan_type = {:plan}
			  AND occurred_at >= {:since}
			GROUP BY user_id
			HAVING SUM(user_cost_rappen) > {:threshold}
			ORDER BY cost DESC
		`).
		Bind(dbx.Params{
			"type":      UsageTransactionType,
			"plan":      string(PlanTypeUnlimited),
			"since":     since.UTC().Format(pbDateLayout),
			"threshold": thresholdRappen,
		}).
		All(&rows)
	if err != nil {
		return nil, err
	}

	flags := make([]FairUseFlag, 0, len(rows))
	for _, row := range rows {
		flags = append(flags, FairUseFlag{
			UserID:            row.UserID,
			RollingCostRappen: row.Cost,
			RequestCount:      row.Count,
		})
	}
	return flags, nil
}
