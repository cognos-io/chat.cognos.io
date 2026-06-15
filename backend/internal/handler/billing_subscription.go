package handler

import (
	"log/slog"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

// BillingSubscriptionParams wires the cancel/resume handlers.
type BillingSubscriptionParams struct {
	Logger *slog.Logger
	Client paddle.Client
}

// BillingCancel schedules the user's subscription to cancel at the end of the
// current period. The plan keeps working until then ("cancels soon") — Paddle's
// subscription.canceled webhook flips it to inactive when the period ends.
func BillingCancel(params BillingSubscriptionParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, subscriptionID, errResp := requireActiveSubscription(e, params.Client)
		if errResp != nil {
			return errResp
		}

		if err := params.Client.CancelSubscription(e.Request.Context(), subscriptionID); err != nil {
			if params.Logger != nil {
				params.Logger.Error("paddle cancel failed", "err", err)
			}
			return apis.NewApiError(http.StatusBadGateway, "Failed to cancel subscription", nil)
		}

		// Reflect "cancels soon" immediately: access lasts until the cycle end.
		record.Set("plan_ends_at", record.GetString("paddle_cycle_end_at"))
		if err := e.App.Save(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to update billing state", err)
		}
		return e.JSON(http.StatusOK, map[string]string{"status": "cancels_soon"})
	}
}

// BillingResume clears a scheduled cancellation, keeping the subscription going.
func BillingResume(params BillingSubscriptionParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		record, subscriptionID, errResp := requireActiveSubscription(e, params.Client)
		if errResp != nil {
			return errResp
		}
		if record.GetString("plan_ends_at") == "" {
			return apis.NewBadRequestError("Subscription is not scheduled to cancel", nil)
		}

		if err := params.Client.ResumeSubscription(e.Request.Context(), subscriptionID); err != nil {
			if params.Logger != nil {
				params.Logger.Error("paddle resume failed", "err", err)
			}
			return apis.NewApiError(http.StatusBadGateway, "Failed to resume subscription", nil)
		}

		record.Set("plan_ends_at", "")
		if err := e.App.Save(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to update billing state", err)
		}
		return e.JSON(http.StatusOK, map[string]string{"status": "active"})
	}
}

// requireActiveSubscription resolves the caller's billing row + active Paddle
// subscription id, or returns the appropriate error response.
func requireActiveSubscription(
	e *core.RequestEvent,
	client paddle.Client,
) (*core.Record, string, error) {
	if e.Auth == nil {
		return nil, "", apis.NewUnauthorizedError("User not authenticated", nil)
	}
	if client == nil {
		return nil, "", apis.NewApiError(http.StatusServiceUnavailable, "Billing is not configured", nil)
	}

	record, err := e.App.FindFirstRecordByData(webhookUserBillingColl, "user_id", e.Auth.Id)
	if err != nil || record == nil {
		return nil, "", apis.NewBadRequestError("No active subscription", nil)
	}
	subscriptionID := record.GetString("paddle_subscription_id")
	if subscriptionID == "" {
		return nil, "", apis.NewBadRequestError("No active subscription", nil)
	}
	return record, subscriptionID, nil
}
