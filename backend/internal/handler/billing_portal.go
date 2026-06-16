package handler

import (
	"log/slog"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

// BillingPortalParams wires the customer-portal handler.
type BillingPortalParams struct {
	Logger *slog.Logger
	Client paddle.Client
}

type portalResponse struct {
	OverviewURL      string `json:"overview_url"`
	UpdatePaymentURL string `json:"update_payment_url,omitempty"`
}

// BillingPortal mints authenticated Paddle customer-portal links for the caller
// and returns them for the frontend to open in a new tab. The overview link
// lands on the portal homepage; the update-payment link (present when the user
// has a subscription) opens straight onto the card form. Links carry a
// short-lived token and are never stored.
func BillingPortal(params BillingPortalParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		if params.Client == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "Billing is not configured", nil)
		}

		customerID := customerIDForUser(e.App, user)
		if customerID == "" {
			// No Paddle customer yet (never checked out) — nothing to manage.
			return apis.NewApiError(http.StatusConflict, "No billing account yet", nil)
		}

		// Pass the active subscription (if any) so the portal can deep-link the
		// payment-method form. A missing billing row is fine — the overview link
		// still works.
		var subscriptionIDs []string
		if record, err := e.App.FindFirstRecordByData(
			webhookUserBillingColl, "user_id", user.Id,
		); err == nil && record != nil {
			if subID := record.GetString("paddle_subscription_id"); subID != "" {
				subscriptionIDs = []string{subID}
			}
		}

		session, err := params.Client.CreatePortalSession(
			e.Request.Context(), customerID, subscriptionIDs,
		)
		if err != nil {
			if params.Logger != nil {
				params.Logger.Error("paddle portal session failed", "err", err)
			}
			return apis.NewApiError(http.StatusBadGateway, "Failed to open billing portal", nil)
		}

		return e.JSON(http.StatusOK, portalResponse{
			OverviewURL:      session.OverviewURL,
			UpdatePaymentURL: session.UpdatePaymentURL,
		})
	}
}
