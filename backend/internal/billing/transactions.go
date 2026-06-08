package billing

import (
	"time"

	"github.com/pocketbase/dbx"
)

// Transaction is a single ledger row exposed via the billing API. It mirrors
// the `balance_transactions` PocketBase collection minus internal-only fields
// (provider_cost_rappen, fx_rate, etc.) that should not leak to the client.
type Transaction struct {
	ID                 string
	OccurredAt         time.Time
	Type               string
	AmountRappen       int64
	BalanceAfterRappen *int64
	EventID            string
	ModelID            string
	Description        string
}

// TransactionsRepo lists balance ledger entries for a user.
type TransactionsRepo interface {
	TransactionsForUser(userID string, limit int) ([]Transaction, error)
}

// TransactionsForUser returns the most recent `limit` balance transactions for
// the given user, ordered newest-first. A limit ≤ 0 falls back to a safe
// default so handlers don't accidentally page through the entire ledger.
func (r *PocketBaseRepo) TransactionsForUser(userID string, limit int) ([]Transaction, error) {
	if limit <= 0 {
		limit = 50
	}

	records, err := r.app.FindRecordsByFilter(
		balanceTransactionsCollectionName,
		"user_id = {:user_id}",
		"-occurred_at",
		limit,
		0,
		dbx.Params{"user_id": userID},
	)
	if err != nil {
		return nil, err
	}

	transactions := make([]Transaction, 0, len(records))
	for _, record := range records {
		amount := int64(record.GetInt("amount_rappen"))
		entry := Transaction{
			ID:           record.Id,
			OccurredAt:   record.GetDateTime("occurred_at").Time().UTC(),
			Type:         record.GetString("type"),
			AmountRappen: amount,
			EventID:      record.GetString("event_id"),
			ModelID:      record.GetString("model_id"),
			Description:  record.GetString("description"),
		}
		// balance_after_rappen is only meaningful when a trial deduction
		// happened — the column is null for unlimited/payg rows. Using the
		// plan_type marker keeps zero-balance trials representable while
		// still hiding the field when it carries no information.
		if record.GetString("plan_type") == string(PlanTypeTrial) {
			balanceAfter := int64(record.GetInt("balance_after_rappen"))
			entry.BalanceAfterRappen = &balanceAfter
		}
		transactions = append(transactions, entry)
	}

	return transactions, nil
}
