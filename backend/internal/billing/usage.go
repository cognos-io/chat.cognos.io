package billing

import (
	"time"

	"github.com/pocketbase/dbx"
)

// pbDateLayout is how PocketBase stores DateTime values in SQLite. Formatting
// the period boundary the same way keeps the lexicographic comparison correct.
const pbDateLayout = "2006-01-02 15:04:05.000Z"

// ModelUsage is the per-model rollup for a billing period. Counts and cost come
// straight from the ledger — message *content* is never read, so this exposes
// nothing the encryption protects.
type ModelUsage struct {
	ModelID         string
	Count           int64
	CostRappen      int64
	CostMicroRappen int64
}

// UsageSummary is the usage breakdown for a period.
type UsageSummary struct {
	PeriodStart  time.Time
	MessageCount int64
	ByModel      []ModelUsage
}

// UsageRepo aggregates ledger usage for a user.
type UsageRepo interface {
	UsageSince(userID string, since time.Time) (UsageSummary, error)
}

// UsageSince rolls up `usage` ledger rows for the user since `since`, grouped by
// model and ordered by spend. It runs a single GROUP BY in SQL rather than
// loading every row, so a heavy month stays cheap.
func (r *PocketBaseRepo) UsageSince(userID string, since time.Time) (UsageSummary, error) {
	type row struct {
		ModelID string `db:"model_id"`
		Count   int64  `db:"cnt"`
		Cost    int64  `db:"cost"`
	}

	var rows []row
	err := r.app.DB().
		NewQuery(`
			SELECT model_id,
			       COUNT(*) AS cnt,
			       COALESCE(SUM(user_cost_microrappen), 0) AS cost
			FROM ` + balanceTransactionsCollectionName + `
			WHERE user_id = {:user_id}
			  AND type = {:type}
			  AND occurred_at >= {:since}
			GROUP BY model_id
			ORDER BY cost DESC, cnt DESC
		`).
		Bind(dbx.Params{
			"user_id": userID,
			"type":    UsageTransactionType,
			"since":   since.UTC().Format(pbDateLayout),
		}).
		All(&rows)
	if err != nil {
		return UsageSummary{}, err
	}

	summary := UsageSummary{PeriodStart: since.UTC(), ByModel: make([]ModelUsage, 0, len(rows))}
	for _, r := range rows {
		summary.MessageCount += r.Count
		summary.ByModel = append(summary.ByModel, ModelUsage{
			ModelID:         r.ModelID,
			Count:           r.Count,
			CostRappen:      CeilRappenFromMicro(r.Cost),
			CostMicroRappen: r.Cost,
		})
	}
	return summary, nil
}
