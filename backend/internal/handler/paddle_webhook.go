package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

const (
	paddleEventsCollection  = "paddle_events"
	webhookUserBillingColl  = "user_billing"
	paygCycleSummariesColl  = "payg_cycle_summaries"
	balanceTransactionsColl = "balance_transactions"
	refundGuaranteeDays     = 60
	cycleSummaryIDLen       = 15
	webhookPBDateLayout     = "2006-01-02 15:04:05.000Z"
)

// PaddleWebhookParams wires the webhook handler. PriceToPlan maps a Paddle
// price id to the plan it activates. MinCommitRappen is the PAYG cycle floor
// (CHF 10.00) used when closing a cycle to compute the overage above it.
// Client + OveragePriceID let a cycle close post the overage charge to Paddle.
type PaddleWebhookParams struct {
	Logger          *slog.Logger
	WebhookSecret   string
	PriceToPlan     map[string]billing.PlanType
	MinCommitRappen int64
	Client          paddle.Client
	OveragePriceID  string
}

// PaddleWebhook ingests Paddle notifications. It verifies the HMAC signature,
// stores every event once (idempotent on paddle_event_id), then dispatches to a
// domain handler. Handler failures return 500 so Paddle retries — domain
// handlers are written to be safe to run repeatedly.
func PaddleWebhook(params PaddleWebhookParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		rawBody, err := io.ReadAll(e.Request.Body)
		if err != nil {
			return apis.NewBadRequestError("Failed to read request body", err)
		}

		// Verify before touching the DB; a bad signature never writes anything.
		if err := paddle.VerifySignature(
			params.WebhookSecret, e.Request.Header.Get("Paddle-Signature"), rawBody,
		); err != nil {
			return apis.NewUnauthorizedError("Invalid webhook signature", nil)
		}

		event, err := paddle.ParseWebhook(rawBody)
		if err != nil || event.EventID == "" {
			return apis.NewBadRequestError("Invalid webhook payload", err)
		}

		// Re-delivery is a no-op.
		if existing, _ := e.App.FindFirstRecordByData(
			paddleEventsCollection, "paddle_event_id", event.EventID,
		); existing != nil {
			return e.JSON(http.StatusOK, map[string]string{"status": "duplicate"})
		}

		record, err := recordPaddleEvent(e.App, event, rawBody)
		if err != nil {
			// A concurrent delivery may have won the unique index → treat as dup.
			if existing, _ := e.App.FindFirstRecordByData(
				paddleEventsCollection, "paddle_event_id", event.EventID,
			); existing != nil {
				return e.JSON(http.StatusOK, map[string]string{"status": "duplicate"})
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to record event", err)
		}

		if dispatchErr := dispatchPaddleEvent(e.Request.Context(), e.App, params, event); dispatchErr != nil {
			record.Set("processing_error", dispatchErr.Error())
			_ = e.App.Save(record)
			if params.Logger != nil {
				params.Logger.Error("paddle webhook processing failed",
					"event_type", event.EventType, "err", dispatchErr)
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to process event", nil)
		}

		record.Set("processed_at", nowRFC3339())
		_ = e.App.Save(record)
		return e.JSON(http.StatusOK, map[string]string{"status": "ok"})
	}
}

// recordPaddleEvent stores the raw event for audit/replay. Indexed ids are
// best-effort (some event types carry only a subset).
func recordPaddleEvent(
	app core.App,
	event paddle.WebhookEvent,
	rawBody []byte,
) (*core.Record, error) {
	collection, err := app.FindCollectionByNameOrId(paddleEventsCollection)
	if err != nil {
		return nil, err
	}

	record := core.NewRecord(collection)
	record.Set("paddle_event_id", event.EventID)
	record.Set("type", event.EventType)
	record.Set("payload_json", string(rawBody))
	record.Set("received_at", nowRFC3339())

	if sub, err := event.Subscription(); err == nil {
		record.Set("paddle_customer_id", sub.CustomerID)
		record.Set("paddle_subscription_id", sub.ID)
	}
	if txn, err := event.Transaction(); err == nil && txn.ID != "" {
		record.Set("paddle_transaction_id", txn.ID)
	}

	if err := app.Save(record); err != nil {
		return nil, err
	}
	return record, nil
}

// dispatchPaddleEvent routes an event to its domain handler. Unknown types are
// intentionally ignored (already stored raw). A returned error triggers a 500
// + Paddle retry, so only genuinely retryable failures should bubble up.
func dispatchPaddleEvent(
	ctx context.Context,
	app core.App,
	params PaddleWebhookParams,
	event paddle.WebhookEvent,
) error {
	switch event.EventType {
	case "subscription.created", "subscription.activated":
		sub, err := event.Subscription()
		if err != nil {
			return err
		}
		return activateSubscription(app, params, sub)
	case "subscription.updated":
		sub, err := event.Subscription()
		if err != nil {
			return err
		}
		return updateSubscription(ctx, app, params, sub)
	case "subscription.canceled":
		sub, err := event.Subscription()
		if err != nil {
			return err
		}
		return cancelSubscription(app, params, sub)
	case "subscription.past_due":
		sub, err := event.Subscription()
		if err != nil {
			return err
		}
		return markSubscriptionPastDue(app, params, sub)
	case "transaction.completed":
		// No plan change in the lean cut; the raw event is stored for audit and
		// (later) PAYG cycle reconciliation.
		return nil
	default:
		return nil
	}
}

// activateSubscription flips the user onto the paid plan the price maps to and
// snapshots the Paddle subscription + cycle. Idempotent: re-delivery re-applies
// the same values.
func activateSubscription(
	app core.App,
	params PaddleWebhookParams,
	sub paddle.SubscriptionData,
) error {
	plan := params.PriceToPlan[sub.PriceID()]
	if plan == "" {
		// Unknown price — can't map to a plan. Not retryable; flag for triage.
		if params.Logger != nil {
			params.Logger.Warn("paddle subscription with unmapped price",
				"price_id", sub.PriceID(), "subscription_id", sub.ID)
		}
		return nil
	}

	userID := resolveWebhookUserID(app, sub.CustomData.UserID, sub.CustomerID)
	if userID == "" {
		if params.Logger != nil {
			params.Logger.Warn("paddle subscription could not be mapped to a user",
				"subscription_id", sub.ID, "customer_id", sub.CustomerID)
		}
		return nil
	}

	// Persist the Paddle customer id on the user so the portal, invoices and
	// checkout handlers can resolve it (the transaction created at checkout has
	// no customer for a brand-new customer — Paddle mints it during payment).
	if sub.CustomerID != "" {
		if user, err := app.FindRecordById("users", userID); err == nil && user != nil &&
			user.GetString("paddle_customer_id") != sub.CustomerID {
			user.Set("paddle_customer_id", sub.CustomerID)
			if err := app.Save(user); err != nil && params.Logger != nil {
				params.Logger.Error("failed to persist paddle_customer_id on user", "err", err)
			}
		}
	}

	return upsertUserBilling(app, userID, func(record *core.Record) {
		record.Set("plan_type", string(plan))
		record.Set("paddle_subscription_id", sub.ID)
		record.Set("paddle_price_id", sub.PriceID())
		// Paid plans don't draw on the trial balance; trial credit is abandoned.
		record.Set("balance_rappen", 0)
		// A (re)activation clears any pending cancellation and any dunning state
		// (Paddle fires subscription.activated on a successful dunning recovery).
		record.Set("plan_ends_at", "")
		record.Set("past_due", false)

		if sub.CurrentBillingPeriod.StartsAt != "" {
			record.Set("paddle_cycle_start_at", sub.CurrentBillingPeriod.StartsAt)
			record.Set("plan_started_at", sub.CurrentBillingPeriod.StartsAt)
		} else {
			record.Set("plan_started_at", nowRFC3339())
		}
		if sub.CurrentBillingPeriod.EndsAt != "" {
			record.Set("paddle_cycle_end_at", sub.CurrentBillingPeriod.EndsAt)
		}
		if record.GetString("refund_eligible_until_at") == "" {
			record.Set("refund_eligible_until_at",
				time.Now().UTC().AddDate(0, 0, refundGuaranteeDays).Format(time.RFC3339))
		}
	})
}

// cancelSubscription drops the user to inactive once Paddle reports the
// subscription canceled (Paddle fires this when the subscription actually ends,
// not when a future cancellation is merely scheduled).
func cancelSubscription(
	app core.App,
	params PaddleWebhookParams,
	sub paddle.SubscriptionData,
) error {
	record, err := app.FindFirstRecordByData(
		webhookUserBillingColl, "paddle_subscription_id", sub.ID,
	)
	if err != nil || record == nil {
		if params.Logger != nil {
			params.Logger.Warn("paddle cancellation for unknown subscription",
				"subscription_id", sub.ID)
		}
		return nil
	}

	record.Set("plan_type", string(billing.PlanTypeInactive))
	record.Set("plan_ends_at", nowRFC3339())
	record.Set("paddle_subscription_id", "")
	record.Set("past_due", false)
	return app.Save(record)
}

// markSubscriptionPastDue flags the user's billing row when Paddle reports a
// failed renewal and starts dunning. The plan keeps working through the grace
// window so the user can fix their card; subscription.activated clears the flag
// on recovery, subscription.canceled drops them to inactive if dunning fails.
// Idempotent: a re-delivered past_due re-sets the same flag.
func markSubscriptionPastDue(
	app core.App,
	params PaddleWebhookParams,
	sub paddle.SubscriptionData,
) error {
	record, err := app.FindFirstRecordByData(
		webhookUserBillingColl, "paddle_subscription_id", sub.ID,
	)
	if err != nil || record == nil {
		if params.Logger != nil {
			params.Logger.Warn("paddle past_due for unknown subscription",
				"subscription_id", sub.ID)
		}
		return nil
	}

	record.Set("past_due", true)
	return app.Save(record)
}

// updateSubscription handles `subscription.updated`. It (1) refreshes the
// user_billing snapshot (plan/price, cycle window, scheduled cancellation) and
// (2) detects a cycle rollover — the billing period advancing — and, for PAYG,
// closes the cycle that just ended so its overage can be billed. Idempotent:
// the snapshot writes are plain assignments and the cycle close is keyed on a
// deterministic id, so a re-delivered event changes nothing.
func updateSubscription(
	ctx context.Context,
	app core.App,
	params PaddleWebhookParams,
	sub paddle.SubscriptionData,
) error {
	userID := resolveWebhookUserID(app, sub.CustomData.UserID, sub.CustomerID)
	if userID == "" {
		// Fall back to the subscription we already track.
		if rec, _ := app.FindFirstRecordByData(
			webhookUserBillingColl, "paddle_subscription_id", sub.ID,
		); rec != nil {
			userID = rec.GetString("user_id")
		}
	}
	if userID == "" {
		if params.Logger != nil {
			params.Logger.Warn("paddle subscription.updated could not be mapped to a user",
				"subscription_id", sub.ID, "customer_id", sub.CustomerID)
		}
		return nil
	}

	// Capture the stored cycle window + plan before we overwrite them so we can
	// detect a rollover against the new billing period.
	var oldStart, oldEnd time.Time
	var oldPlan string
	if rec, _ := app.FindFirstRecordByData(webhookUserBillingColl, "user_id", userID); rec != nil {
		oldStart = rec.GetDateTime("paddle_cycle_start_at").Time().UTC()
		oldEnd = rec.GetDateTime("paddle_cycle_end_at").Time().UTC()
		oldPlan = rec.GetString("plan_type")
	}

	newStart, _ := time.Parse(time.RFC3339, sub.CurrentBillingPeriod.StartsAt)
	rolledOver := !oldStart.IsZero() && !newStart.IsZero() && newStart.After(oldStart)
	if rolledOver && oldPlan == string(billing.PlanTypePayG) && !oldEnd.IsZero() {
		if err := closePAYGCycle(ctx, app, params, userID, sub.ID, oldStart, oldEnd); err != nil {
			return err
		}
	}

	plan := params.PriceToPlan[sub.PriceID()]
	return upsertUserBilling(app, userID, func(record *core.Record) {
		if plan != "" {
			record.Set("plan_type", string(plan))
			record.Set("paddle_price_id", sub.PriceID())
		}
		record.Set("paddle_subscription_id", sub.ID)
		if sub.CurrentBillingPeriod.StartsAt != "" {
			record.Set("paddle_cycle_start_at", sub.CurrentBillingPeriod.StartsAt)
		}
		if sub.CurrentBillingPeriod.EndsAt != "" {
			record.Set("paddle_cycle_end_at", sub.CurrentBillingPeriod.EndsAt)
		}
		// A scheduled cancellation surfaces here as a pending change; its
		// absence means any prior schedule was cleared (resume).
		if sub.ScheduledChange != nil && sub.ScheduledChange.Action == "cancel" {
			record.Set("plan_ends_at", sub.ScheduledChange.EffectiveAt)
		} else {
			record.Set("plan_ends_at", "")
		}
	})
}

// closePAYGCycle writes a payg_cycle_summaries row for the PAYG cycle that just
// ended: the local usage total, the expected bill (max(usage, commit)), and the
// overage above the commit. When the overage is positive it posts a one-time
// charge to Paddle billed on the next renewal. Idempotent — keyed on a
// deterministic id derived from the subscription id + cycle end, so a
// re-delivered rollover never writes a second summary or posts twice.
//
// The summary is persisted before the charge is attempted: a charge failure is
// logged and leaves paddle_overage_txn_id empty + reconciled=false for the
// Phase 4 backstop to retry, but it must NOT fail the webhook — that would block
// the cycle-bound advance below and the event is never re-dispatched.
func closePAYGCycle(
	ctx context.Context,
	app core.App,
	params PaddleWebhookParams,
	userID, subscriptionID string,
	cycleStart, cycleEnd time.Time,
) error {
	id := cycleSummaryID(subscriptionID, cycleEnd)
	if existing, _ := app.FindRecordById(paygCycleSummariesColl, id); existing != nil {
		return nil // cycle already closed
	}

	usage, err := sumPAYGUsageRappen(app, userID, cycleStart, cycleEnd)
	if err != nil {
		return err
	}

	commit := params.MinCommitRappen
	if commit <= 0 {
		commit = billing.DefaultPAYGMinCommitRappen
	}
	summary := billing.ComputeCycleSummary(usage, commit)

	collection, err := app.FindCollectionByNameOrId(paygCycleSummariesColl)
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Id = id
	record.Set("user_id", userID)
	record.Set("paddle_subscription_id", subscriptionID)
	record.Set("cycle_start_at", cycleStart.UTC().Format(time.RFC3339))
	record.Set("cycle_end_at", cycleEnd.UTC().Format(time.RFC3339))
	record.Set("local_usage_rappen", summary.LocalUsageRappen)
	record.Set("local_expected_bill_rappen", summary.LocalExpectedBillRappen)
	record.Set("overage_charge_rappen", summary.OverageChargeRappen)
	record.Set("reconciled", false)
	record.Set("closed_at", nowRFC3339())
	if err := app.Save(record); err != nil {
		return err
	}

	postOverageCharge(ctx, app, params, record, subscriptionID, id, summary.OverageChargeRappen)
	return nil
}

// postOverageCharge posts the cycle's overage to Paddle and records the result
// on the summary. Best-effort: any failure is logged and left for the Phase 4
// backstop (paddle_overage_txn_id stays empty). A deterministic idempotency key
// per cycle guarantees a retry never double-charges.
func postOverageCharge(
	ctx context.Context,
	app core.App,
	params PaddleWebhookParams,
	summary *core.Record,
	subscriptionID, cycleID string,
	overageRappen int64,
) {
	if overageRappen <= 0 {
		return // usage within the commit; nothing to charge
	}
	if params.Client == nil || params.OveragePriceID == "" {
		if params.Logger != nil {
			params.Logger.Warn("PAYG overage not posted: Paddle charge not configured",
				"subscription_id", subscriptionID, "overage_rappen", overageRappen)
		}
		return
	}

	idempotencyKey := "overage_" + cycleID
	txnID, err := params.Client.CreateOneTimeCharge(
		ctx, subscriptionID, params.OveragePriceID, overageRappen, idempotencyKey,
	)
	if err != nil {
		if params.Logger != nil {
			params.Logger.Error("PAYG overage charge failed; backstop will retry",
				"subscription_id", subscriptionID, "overage_rappen", overageRappen, "err", err)
		}
		return
	}

	// Paddle bills next-billing-period charges on the upcoming renewal, so a real
	// transaction id often isn't available yet. Persist it when present, otherwise
	// a deterministic posted-marker so the backstop knows the charge is placed and
	// won't re-post; transaction.completed (Phase 4) overwrites it with the real id.
	if txnID == "" {
		txnID = "posted:" + idempotencyKey
	}
	summary.Set("paddle_overage_txn_id", txnID)
	if err := app.Save(summary); err != nil && params.Logger != nil {
		params.Logger.Error("failed to record paddle_overage_txn_id", "err", err)
	}
}

// sumPAYGUsageRappen totals the user-facing cost of `usage` ledger rows in the
// half-open cycle window [start, end). It reads only ledger metadata, never
// message content.
func sumPAYGUsageRappen(app core.App, userID string, start, end time.Time) (int64, error) {
	var result struct {
		Total int64 `db:"total"`
	}
	err := app.DB().NewQuery(`
		SELECT COALESCE(SUM(user_cost_rappen), 0) AS total
		FROM ` + balanceTransactionsColl + `
		WHERE user_id = {:user_id}
		  AND type = {:type}
		  AND occurred_at >= {:start}
		  AND occurred_at < {:end}
	`).Bind(dbx.Params{
		"user_id": userID,
		"type":    billing.UsageTransactionType,
		"start":   start.UTC().Format(webhookPBDateLayout),
		"end":     end.UTC().Format(webhookPBDateLayout),
	}).One(&result)
	if err != nil {
		return 0, err
	}
	return result.Total, nil
}

// cycleSummaryID derives a stable PocketBase record id for a PAYG cycle so the
// close is idempotent. Hex of a SHA-256 over (subscription id | cycle end)
// satisfies PocketBase's lowercase-alphanumeric id constraint.
func cycleSummaryID(subscriptionID string, cycleEnd time.Time) string {
	sum := sha256.Sum256([]byte(subscriptionID + "|" + cycleEnd.UTC().Format(time.RFC3339)))
	return hex.EncodeToString(sum[:])[:cycleSummaryIDLen]
}

// resolveWebhookUserID maps a Paddle event to a Cognos user: prefer the
// custom_data.user_id we set at checkout, falling back to a paddle_customer_id
// lookup for customers created outside our flow.
func resolveWebhookUserID(app core.App, customDataUserID, customerID string) string {
	if customDataUserID != "" {
		if _, err := app.FindRecordById("users", customDataUserID); err == nil {
			return customDataUserID
		}
	}
	if customerID != "" {
		if user, err := app.FindFirstRecordByData("users", "paddle_customer_id", customerID); err == nil && user != nil {
			return user.Id
		}
	}
	return ""
}

// upsertUserBilling applies mutate to the user's billing row, creating it if it
// somehow doesn't exist yet (every user normally gets one at signup).
func upsertUserBilling(app core.App, userID string, mutate func(*core.Record)) error {
	record, err := app.FindFirstRecordByData(webhookUserBillingColl, "user_id", userID)
	if err != nil || record == nil {
		collection, collErr := app.FindCollectionByNameOrId(webhookUserBillingColl)
		if collErr != nil {
			return collErr
		}
		record = core.NewRecord(collection)
		record.Set("user_id", userID)
	}
	mutate(record)
	return app.Save(record)
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}
