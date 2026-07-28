package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

const (
	paddleEventsCollection  = "paddle_events"
	webhookUserBillingColl  = "user_billing"
	paygCycleSummariesColl  = "payg_cycle_summaries"
	balanceTransactionsColl = "balance_transactions"
	refundsColl             = "refunds"
	orgBillingColl          = "org_billing"
	orgCycleSummariesColl   = "org_cycle_summaries"
	// refundGuaranteeDays mirrors the published Refund Policy window, which
	// matches Paddle's own 14-day policy (Paddle payment verification rejects
	// seller windows with extra conditions).
	refundGuaranteeDays = 14
	cycleSummaryIDLen   = 15
	webhookPBDateLayout = "2006-01-02 15:04:05.000Z"
)

// CycleReconciler records a paid Paddle cycle transaction against its PAYG cycle
// summary. billing.PocketBaseRepo satisfies it.
type CycleReconciler interface {
	RecordCycleTransaction(
		subscriptionID, transactionID string,
		billedRappen int64,
		closedAt string,
	) (bool, error)
}

// PaddleWebhookParams wires the webhook handler. PriceToPlan maps a Paddle
// price id to the plan it activates. MinCommitRappen is the PAYG cycle floor
// (CHF 10.00) used when closing a cycle to compute the overage above it.
// Client + OveragePriceID let a cycle close post the overage charge to Paddle.
// Reconciler records cycle transactions for audit (transaction.completed).
type PaddleWebhookParams struct {
	Logger          *slog.Logger
	WebhookSecret   string
	PriceToPlan     map[string]billing.PlanType
	MinCommitRappen int64
	Client          paddle.Client
	OveragePriceID  string
	Reconciler      CycleReconciler
}

// PaddleWebhook ingests Paddle notifications. It verifies the HMAC signature,
// stores every event once (idempotent on paddle_event_id), then dispatches to a
// domain handler. Handler failures return 500 so Paddle retries — domain
// handlers are written to be safe to run repeatedly.
func PaddleWebhook(params PaddleWebhookParams) func(e *core.RequestEvent) error {
	eventLocks := newKeyedMutex()

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
		unlockEvent := eventLocks.lock(event.EventID)
		defer unlockEvent()

		// Successfully processed events are immutable duplicates. Failed events
		// are retried against their existing audit row so a transient Paddle or
		// database failure cannot permanently strand billing reconciliation.
		record, _ := e.App.FindFirstRecordByData(
			paddleEventsCollection, "paddle_event_id", event.EventID,
		)
		if record != nil && !record.GetDateTime("processed_at").IsZero() {
			return e.JSON(http.StatusOK, map[string]string{"status": "duplicate"})
		}

		if record == nil {
			record, err = recordPaddleEvent(e.App, event, rawBody)
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to record event", err)
			}
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
		record.Set("processing_error", "")
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
		cd := extractCustomData(event.Data)
		subject := resolveWebhookSubject(app, cd.UserID, cd.OrgID, sub.CustomerID, sub.ID)
		if subject.Kind == billing.SubjectOrg {
			return activateOrgSubscription(ctx, app, params, sub, subject.ID)
		}
		return activateSubscription(app, params, sub)
	case "subscription.updated":
		sub, err := event.Subscription()
		if err != nil {
			return err
		}
		cd := extractCustomData(event.Data)
		subject := resolveWebhookSubject(app, cd.UserID, cd.OrgID, sub.CustomerID, sub.ID)
		if subject.Kind == billing.SubjectOrg {
			return updateOrgSubscription(ctx, app, params, sub, subject.ID)
		}
		return updateSubscription(ctx, app, params, sub)
	case "subscription.canceled":
		sub, err := event.Subscription()
		if err != nil {
			return err
		}
		cd := extractCustomData(event.Data)
		subject := resolveWebhookSubject(app, cd.UserID, cd.OrgID, sub.CustomerID, sub.ID)
		if subject.Kind == billing.SubjectOrg {
			return cancelOrgSubscription(app, params, sub)
		}
		return cancelSubscription(app, params, sub)
	case "subscription.past_due":
		sub, err := event.Subscription()
		if err != nil {
			return err
		}
		cd := extractCustomData(event.Data)
		subject := resolveWebhookSubject(app, cd.UserID, cd.OrgID, sub.CustomerID, sub.ID)
		if subject.Kind == billing.SubjectOrg {
			return markOrgPastDue(app, params, sub)
		}
		return markSubscriptionPastDue(app, params, sub)
	case "transaction.completed":
		txn, err := event.Transaction()
		if err != nil {
			return err
		}
		return recordCycleTransaction(app, params, txn)
	case "adjustment.created":
		adj, err := event.Adjustment()
		if err != nil {
			return err
		}
		return recordAdjustment(app, params, adj)
	default:
		return nil
	}
}

// extractCustomData pulls user_id and org_id from raw event JSON. The
// SubscriptionData/TransactionData types only expose user_id; this lets the
// handler resolve org-bound events without modifying the paddle package.
func extractCustomData(raw json.RawMessage) struct{ UserID, OrgID string } {
	var wrapper struct {
		CustomData struct {
			UserID string `json:"user_id"`
			OrgID  string `json:"org_id"`
		} `json:"custom_data"`
	}
	if err := json.Unmarshal(raw, &wrapper); err == nil {
		return struct{ UserID, OrgID string }{
			UserID: wrapper.CustomData.UserID,
			OrgID:  wrapper.CustomData.OrgID,
		}
	}
	return struct{ UserID, OrgID string }{}
}

// resolveWebhookSubject maps a Paddle event to a Cognos billing subject:
//  1. custom_data.org_id
//  2. custom_data.user_id
//  3. paddle_subscription_id lookup in org_billing, then user_billing
//  4. paddle_customer_id lookup on users, then organisations
func resolveWebhookSubject(app core.App, customDataUserID, customDataOrgID, customerID, subscriptionID string) billing.Subject {
	if customDataOrgID != "" {
		if _, err := app.FindRecordById("organisations", customDataOrgID); err == nil {
			return billing.OrgSubject(customDataOrgID)
		}
	}
	if customDataUserID != "" {
		if _, err := app.FindRecordById("users", customDataUserID); err == nil {
			return billing.UserSubject(customDataUserID)
		}
	}
	if subscriptionID != "" {
		if rec, _ := app.FindFirstRecordByData(orgBillingColl, "paddle_subscription_id", subscriptionID); rec != nil {
			return billing.OrgSubject(rec.GetString("organisation"))
		}
		if rec, _ := app.FindFirstRecordByData(webhookUserBillingColl, "paddle_subscription_id", subscriptionID); rec != nil {
			return billing.UserSubject(rec.GetString("user_id"))
		}
	}
	if customerID != "" {
		if user, _ := app.FindFirstRecordByData("users", "paddle_customer_id", customerID); user != nil {
			return billing.UserSubject(user.Id)
		}
		if org, _ := app.FindFirstRecordByData("organisations", "paddle_customer_id", customerID); org != nil {
			return billing.OrgSubject(org.Id)
		}
	}
	return billing.Subject{}
}

// ---------------------------------------------------------------------------
// User path (existing — untouched except for callers above)
// ---------------------------------------------------------------------------

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

// recordCycleTransaction links a paid Paddle cycle transaction to its PAYG
// cycle summary for audit/reconciliation. Non-PAYG transactions (no matching
// open summary) are a no-op; the raw event is still stored.
func recordCycleTransaction(app core.App, params PaddleWebhookParams, txn paddle.TransactionData) error {
	if params.Reconciler == nil || txn.SubscriptionID == "" {
		return nil
	}
	reconciled, err := params.Reconciler.RecordCycleTransaction(
		txn.SubscriptionID, txn.ID, txn.GrandTotalMinor(), nowRFC3339(),
	)
	if err != nil {
		return err
	}
	if reconciled {
		return nil
	}
	// No user cycle matched — try an org cycle.
	return reconcileOrgCycleTransaction(app, txn)
}

// recordAdjustment records a Paddle refund/credit/chargeback as a `refunds`
// ledger row (spec §5.4, §7). It sets the one-refund-per-lifetime flag and, for
// a chargeback, drops the subject to inactive (§7.5). Idempotent on the adjustment
// id; reversals are ignored (Paddle already netted them). No balance is touched
// — Paddle has already moved the money.
func recordAdjustment(app core.App, params PaddleWebhookParams, adj paddle.AdjustmentData) error {
	if adj.ID == "" || strings.HasSuffix(adj.Action, "_reverse") {
		return nil
	}

	// Idempotent: this adjustment already has a refunds row.
	if existing, _ := app.FindRecordsByFilter(
		refundsColl, "paddle_adjustment_ids_json ~ {:adj}", "", 1, 0,
		dbx.Params{"adj": adj.ID},
	); len(existing) > 0 {
		return nil
	}

	subject := resolveAdjustmentSubject(app, adj)
	if subject.ID == "" {
		if params.Logger != nil {
			params.Logger.Warn("paddle adjustment could not be mapped",
				"adjustment_id", adj.ID, "subscription_id", adj.SubscriptionID)
		}
		return nil
	}

	var insideWindow bool
	var userID string
	var billingRecord *core.Record

	switch subject.Kind {
	case billing.SubjectOrg:
		orgID := subject.ID
		userID = orgOwnerID(app, orgID)
		billingRecord, _ = app.FindFirstRecordByData(orgBillingColl, "organisation", orgID)
		// Org billing has no refund_eligible_until_at; window is always false.
		insideWindow = false
	case billing.SubjectUser:
		userID = subject.ID
		billingRecord, _ = app.FindFirstRecordByData(webhookUserBillingColl, "user_id", userID)
		if billingRecord != nil {
			eligible := billingRecord.GetDateTime("refund_eligible_until_at").Time()
			insideWindow = !eligible.IsZero() && time.Now().UTC().Before(eligible)
		}
	}

	if userID == "" {
		return nil
	}

	collection, err := app.FindCollectionByNameOrId(refundsColl)
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]any{
		"adjustment_ids": []string{adj.ID},
		"transaction_id": adj.TransactionID,
		"action":         adj.Action,
	})
	record := core.NewRecord(collection)
	record.Set("user_id", userID)
	record.Set("requested_at", nowRFC3339())
	record.Set("processed_at", nowRFC3339())
	record.Set("gross_refund_rappen", adj.TotalMinor())
	record.Set("usage_deduction_rappen", 0)
	record.Set("net_refund_rappen", adj.TotalMinor())
	record.Set("reason_text", adj.Reason)
	record.Set("operator_id", "paddle_webhook")
	record.Set("inside_guarantee_window", insideWindow)
	record.Set("paddle_adjustment_ids_json", string(payload))
	if subject.Kind == billing.SubjectOrg {
		record.Set("organisation", subject.ID)
	}
	if err := app.Save(record); err != nil {
		return err
	}

	// One refund per lifetime for the user (org owner for org refunds).
	if user, err := app.FindRecordById("users", userID); err == nil && user != nil &&
		!user.GetBool("refund_used") {
		user.Set("refund_used", true)
		if err := app.Save(user); err != nil && params.Logger != nil {
			params.Logger.Error("failed to set refund_used", "err", err)
		}
	}

	// Chargeback deactivates the subject.
	if adj.IsChargeback() && billingRecord != nil {
		billingRecord.Set("plan_type", string(billing.PlanTypeInactive))
		billingRecord.Set("paddle_subscription_id", "")
		billingRecord.Set("plan_ends_at", nowRFC3339())
		if err := app.Save(billingRecord); err != nil && params.Logger != nil {
			params.Logger.Error("failed to deactivate after chargeback", "err", err)
		}
	}

	return nil
}

// resolveAdjustmentSubject maps a Paddle adjustment to a Cognos billing subject
// via the subscription it adjusts, falling back to the customer id.
func resolveAdjustmentSubject(app core.App, adj paddle.AdjustmentData) billing.Subject {
	if adj.SubscriptionID != "" {
		if rec, _ := app.FindFirstRecordByData(orgBillingColl, "paddle_subscription_id", adj.SubscriptionID); rec != nil {
			return billing.OrgSubject(rec.GetString("organisation"))
		}
		if rec, _ := app.FindFirstRecordByData(webhookUserBillingColl, "paddle_subscription_id", adj.SubscriptionID); rec != nil {
			return billing.UserSubject(rec.GetString("user_id"))
		}
	}
	if adj.CustomerID != "" {
		if user, _ := app.FindFirstRecordByData("users", "paddle_customer_id", adj.CustomerID); user != nil {
			return billing.UserSubject(user.Id)
		}
		if org, _ := app.FindFirstRecordByData("organisations", "paddle_customer_id", adj.CustomerID); org != nil {
			return billing.OrgSubject(org.Id)
		}
	}
	return billing.Subject{}
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
		SELECT COALESCE(SUM(user_cost_microrappen), 0) AS total
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
	// Round the cycle's exact sub-rappen usage up to whole rappen — the unit
	// Paddle bills overage in — only once, here at the charge boundary.
	return billing.CeilRappenFromMicro(result.Total), nil
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

// ---------------------------------------------------------------------------
// Org path (new)
// ---------------------------------------------------------------------------

// activateOrgSubscription flips the Organisation onto the paid plan and
// snapshots the Paddle subscription + cycle. Idempotent: re-delivery re-applies
// the same values.
func activateOrgSubscription(
	ctx context.Context,
	app core.App,
	params PaddleWebhookParams,
	sub paddle.SubscriptionData,
	orgID string,
) error {
	plan := params.PriceToPlan[sub.PriceID()]
	if plan == "" {
		if params.Logger != nil {
			params.Logger.Warn("paddle org subscription with unmapped price",
				"price_id", sub.PriceID(), "subscription_id", sub.ID)
		}
		return nil
	}

	// Persist the Paddle customer id on the org so the portal can resolve it.
	if sub.CustomerID != "" {
		if org, err := app.FindRecordById("organisations", orgID); err == nil && org != nil &&
			org.GetString("paddle_customer_id") != sub.CustomerID {
			org.Set("paddle_customer_id", sub.CustomerID)
			if err := app.Save(org); err != nil && params.Logger != nil {
				params.Logger.Error("failed to persist paddle_customer_id on org", "err", err)
			}
		}
	}

	seatQty := billing.MinOrgSeatQuantity
	if len(sub.Items) > 0 {
		seatQty = billing.ClampOrgSeatQuantity(int64(sub.Items[0].Quantity))
	}
	seatQty, err := reconcileOrgSeatUnderbilling(ctx, app, params, sub, orgID, seatQty)
	if err != nil {
		return err
	}

	record, err := app.FindFirstRecordByData(orgBillingColl, "organisation", orgID)
	if err != nil || record == nil {
		collection, collErr := app.FindCollectionByNameOrId(orgBillingColl)
		if collErr != nil {
			return collErr
		}
		record = core.NewRecord(collection)
		record.Set("organisation", orgID)
	}
	record.Set("plan_type", string(plan))
	record.Set("paddle_subscription_id", sub.ID)
	record.Set("paddle_price_id", sub.PriceID())
	record.Set("paddle_customer_id", sub.CustomerID)
	record.Set("past_due", false)
	record.Set("seat_quantity", seatQty)
	if sub.CurrentBillingPeriod.StartsAt != "" {
		record.Set("paddle_cycle_start_at", sub.CurrentBillingPeriod.StartsAt)
	}
	if sub.CurrentBillingPeriod.EndsAt != "" {
		record.Set("paddle_cycle_end_at", sub.CurrentBillingPeriod.EndsAt)
	}
	return app.Save(record)
}

// updateOrgSubscription refreshes the org_billing snapshot and detects cycle
// rollover. For PAYG, it closes the cycle that just ended using the closing
// cycle's seat quantity, then applies any pending_seat_quantity.
func updateOrgSubscription(
	ctx context.Context,
	app core.App,
	params PaddleWebhookParams,
	sub paddle.SubscriptionData,
	orgID string,
) error {
	record, err := app.FindFirstRecordByData(orgBillingColl, "organisation", orgID)
	if err != nil || record == nil {
		if params.Logger != nil {
			params.Logger.Warn("paddle subscription.updated for unknown org", "org_id", orgID)
		}
		return nil
	}

	oldStart := record.GetDateTime("paddle_cycle_start_at").Time().UTC()
	oldEnd := record.GetDateTime("paddle_cycle_end_at").Time().UTC()
	oldPlan := record.GetString("plan_type")
	oldSeatQty := int64(record.GetInt("seat_quantity"))
	pendingSeatQty := int64(record.GetInt("pending_seat_quantity"))

	newStart, _ := time.Parse(time.RFC3339, sub.CurrentBillingPeriod.StartsAt)
	rolledOver := !oldStart.IsZero() && !newStart.IsZero() && newStart.After(oldStart)
	if rolledOver && oldPlan == string(billing.PlanTypePayG) && !oldEnd.IsZero() {
		if err := closeOrgPAYGCycle(ctx, app, params, orgID, sub.ID, oldStart, oldEnd, oldSeatQty); err != nil {
			return err
		}
		// Apply pending seat change after the cycle that used the old qty closed.
		if pendingSeatQty > 0 {
			record.Set("seat_quantity", billing.ClampOrgSeatQuantity(pendingSeatQty))
			record.Set("pending_seat_quantity", 0)
		} else if len(sub.Items) > 0 {
			record.Set("seat_quantity", billing.ClampOrgSeatQuantity(int64(sub.Items[0].Quantity)))
		}
	}

	plan := params.PriceToPlan[sub.PriceID()]
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
	// A scheduled cancellation would surface here (sub.ScheduledChange with
	// action "cancel"); org_billing deliberately does not track it — there is
	// no plan_ends_at field — and a cleared schedule (resume) needs no action.

	// Sync quantity on non-rollover updates.
	if !rolledOver && len(sub.Items) > 0 {
		record.Set("seat_quantity", billing.ClampOrgSeatQuantity(int64(sub.Items[0].Quantity)))
	}
	reconciledSeatQty, err := reconcileOrgSeatUnderbilling(
		ctx,
		app,
		params,
		sub,
		orgID,
		int64(record.GetInt("seat_quantity")),
	)
	if err != nil {
		return err
	}
	if reconciledSeatQty > int64(record.GetInt("seat_quantity")) {
		record.Set("seat_quantity", reconciledSeatQty)
		if pendingSeatQty > 0 && pendingSeatQty < reconciledSeatQty {
			record.Set("pending_seat_quantity", reconciledSeatQty)
		}
	}

	return app.Save(record)
}

// reconcileOrgSeatUnderbilling repairs stale Paddle quantities after members
// join while an Organisation is inactive or past due. Seat removals remain a
// next-cycle operation (spec decision #3), so this guard only raises quantity.
func reconcileOrgSeatUnderbilling(
	ctx context.Context,
	app core.App,
	params PaddleWebhookParams,
	sub paddle.SubscriptionData,
	orgID string,
	reportedSeatQty int64,
) (int64, error) {
	if len(sub.Items) == 0 {
		return reportedSeatQty, nil
	}

	members, err := organisations.NewPocketBaseRepo(app).ListMembers(orgID)
	if err != nil {
		return reportedSeatQty, fmt.Errorf("list active Organisation members: %w", err)
	}
	desiredSeatQty := billing.BilledOrgSeatQuantity(int64(len(members)))
	paddleSeatQty := billing.ClampOrgSeatQuantity(int64(sub.Items[0].Quantity))
	if desiredSeatQty <= paddleSeatQty {
		return reportedSeatQty, nil
	}

	seatUpdater, ok := params.Client.(paddle.SeatQuantityUpdater)
	if !ok || seatUpdater == nil {
		return reportedSeatQty, fmt.Errorf("paddle: seat quantity updater is unavailable")
	}
	if sub.ID == "" || sub.PriceID() == "" {
		return reportedSeatQty, fmt.Errorf("paddle: subscription or seat price is missing")
	}
	if err := seatUpdater.UpdateSubscriptionQuantity(
		ctx,
		sub.ID,
		sub.PriceID(),
		int(desiredSeatQty),
		"prorated_immediately",
	); err != nil {
		return reportedSeatQty, fmt.Errorf("reconcile Organisation Seats in Paddle: %w", err)
	}
	return desiredSeatQty, nil
}

// cancelOrgSubscription drops the org to inactive once Paddle reports the
// subscription canceled.
func cancelOrgSubscription(
	app core.App,
	params PaddleWebhookParams,
	sub paddle.SubscriptionData,
) error {
	record, err := app.FindFirstRecordByData(orgBillingColl, "paddle_subscription_id", sub.ID)
	if err != nil || record == nil {
		if params.Logger != nil {
			params.Logger.Warn("paddle cancellation for unknown org subscription",
				"subscription_id", sub.ID)
		}
		return nil
	}

	record.Set("plan_type", string(billing.PlanTypeInactive))
	record.Set("paddle_subscription_id", "")
	record.Set("past_due", false)
	return app.Save(record)
}

// markOrgPastDue flags the org's billing row when Paddle reports a failed
// renewal. Idempotent: a re-delivered past_due re-sets the same flag.
func markOrgPastDue(
	app core.App,
	params PaddleWebhookParams,
	sub paddle.SubscriptionData,
) error {
	record, err := app.FindFirstRecordByData(orgBillingColl, "paddle_subscription_id", sub.ID)
	if err != nil || record == nil {
		if params.Logger != nil {
			params.Logger.Warn("paddle past_due for unknown org subscription",
				"subscription_id", sub.ID)
		}
		return nil
	}

	record.Set("past_due", true)
	return app.Save(record)
}

// closeOrgPAYGCycle writes an org_cycle_summaries row for the pooled cycle that
// just ended. The floor is seatQuantity x commit. Idempotent — keyed on the
// same deterministic id used for user cycles.
func closeOrgPAYGCycle(
	ctx context.Context,
	app core.App,
	params PaddleWebhookParams,
	orgID, subscriptionID string,
	cycleStart, cycleEnd time.Time,
	seatQuantity int64,
) error {
	id := cycleSummaryID(subscriptionID, cycleEnd)
	if existing, _ := app.FindRecordById(orgCycleSummariesColl, id); existing != nil {
		return nil // cycle already closed
	}

	usageMicro, err := sumOrgPAYGUsageMicro(app, orgID, cycleStart, cycleEnd)
	if err != nil {
		return err
	}
	usageRappen := billing.CeilRappenFromMicro(usageMicro)

	commit := params.MinCommitRappen
	if commit <= 0 {
		commit = billing.DefaultPAYGMinCommitRappen
	}
	summary := billing.ComputeOrgCycleSummary(usageRappen, seatQuantity, commit)

	collection, err := app.FindCollectionByNameOrId(orgCycleSummariesColl)
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Id = id
	record.Set("organisation", orgID)
	record.Set("paddle_subscription_id", subscriptionID)
	record.Set("cycle_start_at", cycleStart.UTC().Format(time.RFC3339))
	record.Set("cycle_end_at", cycleEnd.UTC().Format(time.RFC3339))
	record.Set("seat_quantity", summary.SeatQuantity)
	record.Set("pooled_usage_rappen", summary.PooledUsageRappen)
	record.Set("pooled_usage_microrappen", usageMicro)
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

// sumOrgPAYGUsageMicro totals the microrappen cost of org-attributed `usage`
// ledger rows in the half-open cycle window [start, end).
func sumOrgPAYGUsageMicro(app core.App, orgID string, start, end time.Time) (int64, error) {
	var result struct {
		Total int64 `db:"total"`
	}
	err := app.DB().NewQuery(`
		SELECT COALESCE(SUM(user_cost_microrappen), 0) AS total
		FROM ` + balanceTransactionsColl + `
		WHERE organisation = {:org_id}
		  AND type = {:type}
		  AND occurred_at >= {:start}
		  AND occurred_at < {:end}
	`).Bind(dbx.Params{
		"org_id": orgID,
		"type":   billing.UsageTransactionType,
		"start":  start.UTC().Format(webhookPBDateLayout),
		"end":    end.UTC().Format(webhookPBDateLayout),
	}).One(&result)
	return result.Total, err
}

// reconcileOrgCycleTransaction links a paid Paddle cycle transaction to an open
// org_cycle_summaries row. Mirrors the user reconciler behaviour.
func reconcileOrgCycleTransaction(app core.App, txn paddle.TransactionData) error {
	if txn.SubscriptionID == "" || txn.ID == "" {
		return nil
	}
	// Already recorded this transaction → no-op.
	existing, _ := app.FindRecordsByFilter(
		orgCycleSummariesColl,
		"paddle_transaction_id = {:txn}",
		"", 1, 0,
		dbx.Params{"txn": txn.ID},
	)
	if len(existing) > 0 {
		return nil
	}

	// Match the oldest still-open summary (no transaction recorded) for the sub.
	candidates, err := app.FindRecordsByFilter(
		orgCycleSummariesColl,
		"paddle_subscription_id = {:sub} && (paddle_transaction_id = '' || paddle_transaction_id = null)",
		"cycle_end_at", 1, 0,
		dbx.Params{"sub": txn.SubscriptionID},
	)
	if err != nil || len(candidates) == 0 {
		return nil
	}

	record := candidates[0]
	expected := int64(record.GetInt("local_expected_bill_rappen"))
	record.Set("paddle_transaction_id", txn.ID)
	record.Set("paddle_billed_rappen", txn.GrandTotalMinor())
	record.Set("reconciled", txn.GrandTotalMinor() >= expected)
	return app.Save(record)
}

// orgOwnerID returns the owner user id of an Organisation.
func orgOwnerID(app core.App, orgID string) string {
	org, err := app.FindRecordById("organisations", orgID)
	if err != nil || org == nil {
		return ""
	}
	return org.GetString("owner")
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}
