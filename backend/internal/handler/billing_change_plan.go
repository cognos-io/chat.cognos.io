package handler

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

// Proration modes for a plan switch. Upgrades bill the prorated difference now;
// downgrades and lateral switches don't move money mid-cycle — the new price is
// billed in full at the next renewal (spec §3.4, decisions #7/#11).
const (
	prorationUpgrade   = "prorated_immediately"
	prorationDowngrade = "full_next_billing_period"
)

// BillingChangePlanParams wires the change-plan handler. OveragePriceID +
// MinCommitRappen let it close the open PAYG cycle (posting any final overage)
// when the user switches away from PAYG.
type BillingChangePlanParams struct {
	Logger          *slog.Logger
	Client          paddle.Client
	Prices          map[string]string
	OveragePriceID  string
	MinCommitRappen int64
}

type changePlanRequest struct {
	Plan      string `json:"plan"`
	ReturnURL string `json:"return_url"`
}

type changePlanResponse struct {
	Status        string `json:"status"` // "changed" | "unchanged" | "checkout"
	CheckoutURL   string `json:"checkout_url,omitempty"`
	TransactionID string `json:"transaction_id,omitempty"`
}

// BillingChangePlan switches a user between plans by modifying their existing
// Paddle subscription — never creating a second one. If the user has no active
// subscription (trial / inactive / resubscribe), it falls back to checkout and
// returns a checkout URL instead.
func BillingChangePlan(params BillingChangePlanParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		if params.Client == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "Billing is not configured", nil)
		}

		var req changePlanRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		targetPrice := strings.TrimSpace(params.Prices[req.Plan])
		if targetPrice == "" {
			return apis.NewBadRequestError("Unknown or unavailable plan", nil)
		}

		record, _ := e.App.FindFirstRecordByData(webhookUserBillingColl, "user_id", user.Id)
		subscriptionID := ""
		if record != nil {
			subscriptionID = record.GetString("paddle_subscription_id")
		}

		// No live subscription → this is a first purchase / resubscribe. Open a
		// hosted checkout for the chosen plan instead of patching a subscription.
		if subscriptionID == "" {
			return startCheckoutFallback(e, params, user, targetPrice, req.ReturnURL)
		}

		if record.GetString("paddle_price_id") == targetPrice {
			return e.JSON(http.StatusOK, changePlanResponse{Status: "unchanged"})
		}

		currentPlan := record.GetString("plan_type")
		switchingFromPAYG := currentPlan == string(billing.PlanTypePayG)
		isUpgrade := switchingFromPAYG &&
			(req.Plan == planUnlimitedMonthly || req.Plan == planUnlimitedAnnual)

		// Switching away from PAYG: bill the final cycle now. closePAYGCycle is
		// keyed on a deterministic id per (subscription, cycle_end), so this never
		// double-charges even if a rollover later closes the same cycle.
		if switchingFromPAYG {
			closeOpenPaygCycle(e, params, user.Id, subscriptionID, record)
		}

		prorationMode := prorationDowngrade
		if isUpgrade {
			prorationMode = prorationUpgrade
		}

		if err := params.Client.ChangeSubscriptionPrice(
			e.Request.Context(), subscriptionID, targetPrice, prorationMode,
		); err != nil {
			if params.Logger != nil {
				params.Logger.Error("paddle change-plan failed", "err", err, "plan", req.Plan)
			}
			return apis.NewApiError(http.StatusBadGateway, "Failed to change plan", nil)
		}

		// Optimistically reflect the new plan locally; subscription.updated
		// confirms it. Paddle applies the item change immediately either way.
		targetPlanType := billing.PlanTypeUnlimited
		if req.Plan == planPAYG {
			targetPlanType = billing.PlanTypePayG
		}
		record.Set("paddle_price_id", targetPrice)
		record.Set("plan_type", string(targetPlanType))
		if err := e.App.Save(record); err != nil && params.Logger != nil {
			params.Logger.Error("failed to reflect plan change locally", "err", err)
		}

		return e.JSON(http.StatusOK, changePlanResponse{Status: "changed"})
	}
}

// closeOpenPaygCycle posts any final PAYG overage for the open cycle when the
// user switches away from PAYG. Best-effort: a failure is logged, never blocks
// the switch (reconciliation can still pick it up).
func closeOpenPaygCycle(
	e *core.RequestEvent,
	params BillingChangePlanParams,
	userID, subscriptionID string,
	record *core.Record,
) {
	cycleStart := record.GetDateTime("paddle_cycle_start_at").Time().UTC()
	cycleEnd := record.GetDateTime("paddle_cycle_end_at").Time().UTC()
	if cycleStart.IsZero() || cycleEnd.IsZero() {
		return
	}
	wp := PaddleWebhookParams{
		Logger:          params.Logger,
		Client:          params.Client,
		OveragePriceID:  params.OveragePriceID,
		MinCommitRappen: params.MinCommitRappen,
	}
	if err := closePAYGCycle(
		e.Request.Context(), e.App, wp, userID, subscriptionID, cycleStart, cycleEnd,
	); err != nil && params.Logger != nil {
		params.Logger.Error("failed to close PAYG cycle on plan switch", "err", err)
	}
}

// startCheckoutFallback opens a hosted checkout for a user without a live
// subscription, mirroring BillingCheckout's persistence of the Paddle customer.
func startCheckoutFallback(
	e *core.RequestEvent,
	params BillingChangePlanParams,
	user *core.Record,
	priceID, returnURL string,
) error {
	result, err := params.Client.CreateCheckout(e.Request.Context(), paddle.CheckoutRequest{
		PriceID:    priceID,
		UserID:     user.Id,
		CustomerID: user.GetString("paddle_customer_id"),
		ReturnURL:  strings.TrimSpace(returnURL),
	})
	if err != nil {
		if params.Logger != nil {
			params.Logger.Error("change-plan checkout fallback failed", "err", err)
		}
		return apis.NewApiError(http.StatusBadGateway, "Failed to start checkout", nil)
	}

	if result.CustomerID != "" && result.CustomerID != user.GetString("paddle_customer_id") {
		user.Set("paddle_customer_id", result.CustomerID)
		if err := e.App.Save(user); err != nil && params.Logger != nil {
			params.Logger.Error("failed to persist paddle_customer_id", "err", err)
		}
	}

	return e.JSON(http.StatusOK, changePlanResponse{
		Status:        "checkout",
		CheckoutURL:   result.CheckoutURL,
		TransactionID: result.TransactionID,
	})
}
