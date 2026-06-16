package handler

import (
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

const (
	paddleEventsCollection = "paddle_events"
	webhookUserBillingColl = "user_billing"
	refundGuaranteeDays    = 60
)

// PaddleWebhookParams wires the webhook handler. PriceToPlan maps a Paddle
// price id to the plan it activates.
type PaddleWebhookParams struct {
	Logger        *slog.Logger
	WebhookSecret string
	PriceToPlan   map[string]billing.PlanType
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

		if dispatchErr := dispatchPaddleEvent(e.App, params, event); dispatchErr != nil {
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
	case "subscription.canceled":
		sub, err := event.Subscription()
		if err != nil {
			return err
		}
		return cancelSubscription(app, params, sub)
	case "subscription.past_due", "transaction.completed":
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
		// A (re)activation clears any pending cancellation.
		record.Set("plan_ends_at", "")

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
	return app.Save(record)
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
