package billing

import (
	"context"
	"log/slog"

	"github.com/pocketbase/dbx"
)

const paygCycleSummariesCollectionName = "payg_cycle_summaries"

// OverageCharger posts a PAYG overage as a one-time charge. paddle.Client
// satisfies it; billing defines the narrow interface it needs so it doesn't
// depend on the paddle package.
type OverageCharger interface {
	CreateOneTimeCharge(
		ctx context.Context,
		subscriptionID, priceID string,
		quantity int64,
		idempotencyKey string,
	) (string, error)
}

// openOverage is a closed cycle whose overage charge never landed.
type openOverage struct {
	SummaryID      string `db:"id"`
	SubscriptionID string `db:"paddle_subscription_id"`
	OverageRappen  int64  `db:"overage_charge_rappen"`
}

// RetryUnpostedOverages re-posts overage charges for closed PAYG cycles whose
// charge never landed (overage > 0 but paddle_overage_txn_id still empty —
// e.g. the original post failed transiently in closePAYGCycle). The
// deterministic idempotency key `overage_<cycle_id>` makes a re-post safe even
// if the original silently succeeded: Paddle returns the same charge rather than
// billing twice. Returns the number of cycles for which a charge now lands.
//
// This is the spec §11.3 / §14.7 backstop — the only PAYG self-healing path,
// since a failed charge in the webhook does not re-dispatch.
func (r *PocketBaseRepo) RetryUnpostedOverages(
	ctx context.Context,
	charger OverageCharger,
	overagePriceID string,
	logger *slog.Logger,
) (int, error) {
	if charger == nil || overagePriceID == "" {
		return 0, nil
	}

	var rows []openOverage
	err := r.app.DB().
		NewQuery(`
			SELECT id, paddle_subscription_id, overage_charge_rappen
			FROM ` + paygCycleSummariesCollectionName + `
			WHERE overage_charge_rappen > 0
			  AND (paddle_overage_txn_id = '' OR paddle_overage_txn_id IS NULL)
			  AND paddle_subscription_id != ''
		`).
		All(&rows)
	if err != nil {
		return 0, err
	}

	posted := 0
	for _, row := range rows {
		idempotencyKey := "overage_" + row.SummaryID
		txnID, chargeErr := charger.CreateOneTimeCharge(
			ctx, row.SubscriptionID, overagePriceID, row.OverageRappen, idempotencyKey,
		)
		if chargeErr != nil {
			if logger != nil {
				logger.Error("backstop: overage re-post failed; will retry next pass",
					"cycle_id", row.SummaryID, "err", chargeErr)
			}
			continue
		}

		if txnID == "" {
			txnID = "posted:" + idempotencyKey
		}
		record, findErr := r.app.FindRecordById(paygCycleSummariesCollectionName, row.SummaryID)
		if findErr != nil || record == nil {
			continue
		}
		record.Set("paddle_overage_txn_id", txnID)
		if saveErr := r.app.Save(record); saveErr != nil {
			if logger != nil {
				logger.Error("backstop: failed to record overage txn id",
					"cycle_id", row.SummaryID, "err", saveErr)
			}
			continue
		}
		posted++
	}

	return posted, nil
}

// RecordCycleTransaction links a Paddle cycle transaction to its PAYG cycle
// summary for audit/reconciliation. It matches the open summary for the
// subscription (one without a recorded transaction yet) and stores the Paddle
// transaction id + billed amount, marking it reconciled when the billed amount
// covers at least what we locally expected (Paddle never under-billing the
// floor). Idempotent: a re-delivered transaction for an already-recorded
// summary is a no-op.
//
// NOTE: with the "commit in advance + overage in arrears" model a single Paddle
// transaction can span two cycles' charges; the exact per-cycle amount
// reconciliation is pending verification against live Paddle data (Phase 8).
// Until then we record for audit and only assert the safe lower bound.
func (r *PocketBaseRepo) RecordCycleTransaction(
	subscriptionID, transactionID string,
	billedRappen int64,
	closedAt string,
) (bool, error) {
	if subscriptionID == "" || transactionID == "" {
		return false, nil
	}

	// Already recorded this transaction → no-op (idempotent re-delivery).
	existing, _ := r.app.FindRecordsByFilter(
		paygCycleSummariesCollectionName,
		"paddle_transaction_id = {:txn}",
		"", 1, 0,
		dbx.Params{"txn": transactionID},
	)
	if len(existing) > 0 {
		return false, nil
	}

	// Match the oldest still-open summary (no transaction recorded) for the sub.
	candidates, err := r.app.FindRecordsByFilter(
		paygCycleSummariesCollectionName,
		"paddle_subscription_id = {:sub} && (paddle_transaction_id = '' || paddle_transaction_id = null)",
		"cycle_end_at", 1, 0,
		dbx.Params{"sub": subscriptionID},
	)
	if err != nil {
		return false, err
	}
	if len(candidates) == 0 {
		return false, nil
	}

	record := candidates[0]
	expected := int64(record.GetInt("local_expected_bill_rappen"))
	record.Set("paddle_transaction_id", transactionID)
	record.Set("paddle_billed_rappen", billedRappen)
	record.Set("reconciled", billedRappen >= expected)
	if closedAt != "" {
		record.Set("closed_at", closedAt)
	}
	if err := r.app.Save(record); err != nil {
		return false, err
	}
	return true, nil
}
