package handler

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

// Plan keys accepted by the checkout endpoint. PAYG and the two Unlimited
// intervals each map to a distinct Paddle price.
const (
	planPAYG             = "payg"
	planUnlimitedMonthly = "unlimited_monthly"
	planUnlimitedAnnual  = "unlimited_annual"
)

type checkoutBusiness struct {
	Name    string `json:"name"`
	VATID   string `json:"vat_id"`
	Country string `json:"country"`
}

type checkoutRequest struct {
	Plan      string            `json:"plan"`
	Business  *checkoutBusiness `json:"business,omitempty"`
	ReturnURL string            `json:"return_url"`
}

type checkoutResponse struct {
	// TransactionID lets the frontend open the Paddle.js overlay for this
	// server-created transaction. CheckoutURL is the hosted-page fallback.
	TransactionID string `json:"transaction_id"`
	CheckoutURL   string `json:"checkout_url"`
}

// BillingCheckoutParams wires the checkout handler. Prices maps a plan key to a
// configured Paddle price id; a missing/empty entry means that plan can't be
// purchased (misconfiguration → 400 for that plan).
type BillingCheckoutParams struct {
	Logger *slog.Logger
	Client paddle.Client
	Prices map[string]string
}

// BillingCheckout creates a Paddle hosted-checkout for the chosen plan and
// returns its URL for the frontend to redirect to. Business details (when
// supplied) are mirrored onto the user record so our dashboard can show them,
// and forwarded to Paddle for the invoice.
func BillingCheckout(params BillingCheckoutParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		if params.Client == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "Billing is not configured", nil)
		}

		var req checkoutRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		priceID := strings.TrimSpace(params.Prices[req.Plan])
		if priceID == "" {
			return apis.NewBadRequestError("Unknown or unavailable plan", nil)
		}

		if err := persistBusiness(e, user, req.Business); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to save business details", err)
		}

		result, err := params.Client.CreateCheckout(e.Request.Context(), paddle.CheckoutRequest{
			PriceID:    priceID,
			UserID:     user.Id,
			CustomerID: user.GetString("paddle_customer_id"),
			Business:   businessForPaddle(req.Business),
			ReturnURL:  strings.TrimSpace(req.ReturnURL),
		})
		if err != nil {
			if params.Logger != nil {
				params.Logger.Error("paddle checkout failed", "err", err, "plan", req.Plan)
			}
			return apis.NewApiError(http.StatusBadGateway, "Failed to start checkout", nil)
		}

		// Remember the Paddle customer so future checkouts reuse it.
		if result.CustomerID != "" && result.CustomerID != user.GetString("paddle_customer_id") {
			user.Set("paddle_customer_id", result.CustomerID)
			if err := e.App.Save(user); err != nil && params.Logger != nil {
				params.Logger.Error("failed to persist paddle_customer_id", "err", err)
			}
		}

		return e.JSON(http.StatusOK, checkoutResponse{
			TransactionID: result.TransactionID,
			CheckoutURL:   result.CheckoutURL,
		})
	}
}

// persistBusiness mirrors company-invoicing fields onto the user record. No-op
// when the buyer didn't supply business details.
func persistBusiness(e *core.RequestEvent, user *core.Record, business *checkoutBusiness) error {
	if business == nil {
		return nil
	}
	user.Set("business_name", strings.TrimSpace(business.Name))
	user.Set("business_vat_id", strings.TrimSpace(business.VATID))
	user.Set("business_country", strings.TrimSpace(business.Country))
	return e.App.Save(user)
}

func businessForPaddle(business *checkoutBusiness) *paddle.Business {
	if business == nil {
		return nil
	}
	return &paddle.Business{
		Name:        strings.TrimSpace(business.Name),
		TaxID:       strings.TrimSpace(business.VATID),
		CountryCode: strings.TrimSpace(business.Country),
	}
}
