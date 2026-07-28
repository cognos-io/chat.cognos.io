package handler

import (
	"log/slog"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

// BillingInvoicePDFParams wires the per-invoice PDF handler.
type BillingInvoicePDFParams struct {
	Logger *slog.Logger
	Client paddle.Client
}

// BillingInvoicePDF returns a short-lived URL to the PDF for one of the caller's
// invoices. It verifies the transaction belongs to the caller's Paddle customer
// *before* fetching the invoice, so a user can never read another customer's
// invoice by guessing a transaction id.
func BillingInvoicePDF(params BillingInvoicePDFParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		if params.Client == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "Billing is not configured", nil)
		}

		transactionID := e.Request.PathValue("id")
		if transactionID == "" {
			return apis.NewBadRequestError("Missing transaction id", nil)
		}

		customerID := customerIDForUser(e.App, user)
		if customerID == "" {
			return apis.NewNotFoundError("Invoice not found", nil)
		}

		// Ownership check first - never call the invoice endpoint for a
		// transaction the caller doesn't own.
		owner, err := params.Client.GetTransactionCustomerID(e.Request.Context(), transactionID)
		if err != nil {
			if params.Logger != nil {
				params.Logger.Error("paddle get transaction failed", "err", err)
			}
			return apis.NewNotFoundError("Invoice not found", nil)
		}
		if owner != customerID {
			// Don't reveal whether the transaction exists for another customer.
			return apis.NewNotFoundError("Invoice not found", nil)
		}

		url, err := params.Client.GetInvoicePDFURL(e.Request.Context(), transactionID)
		if err != nil {
			if params.Logger != nil {
				params.Logger.Error("paddle get invoice pdf failed", "err", err)
			}
			return upstreamError("Failed to fetch invoice", err)
		}

		return e.JSON(http.StatusOK, map[string]string{"url": url})
	}
}
