package handler

import (
	"log/slog"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
)

// BillingInvoicesParams wires the invoices/card handler.
type BillingInvoicesParams struct {
	Logger *slog.Logger
	Client paddle.Client
}

type cardResponse struct {
	Brand       string `json:"brand"`
	Last4       string `json:"last4"`
	ExpiryMonth int    `json:"expiry_month"`
	ExpiryYear  int    `json:"expiry_year"`
}

type invoiceResponse struct {
	ID            string `json:"id"`
	InvoiceNumber string `json:"invoice_number"`
	Status        string `json:"status"`
	Currency      string `json:"currency"`
	AmountMinor   int64  `json:"amount_minor"`
	BilledAt      string `json:"billed_at,omitempty"`
}

type invoicesResponse struct {
	Card     *cardResponse     `json:"card"`
	Invoices []invoiceResponse `json:"invoices"`
}

// BillingInvoices returns the caller's saved card and Paddle invoices for the
// dashboard. Both are scoped to the user's own Paddle customer. A user without
// a Paddle customer (e.g. on the trial) simply gets an empty payload — not an
// error — so the dashboard renders its empty states. Paddle failures degrade
// gracefully: the card/invoices are omitted rather than failing the page.
func BillingInvoices(params BillingInvoicesParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		resp := invoicesResponse{Invoices: []invoiceResponse{}}

		customerID := customerIDForUser(e.App, user)
		if params.Client == nil || customerID == "" {
			return e.JSON(http.StatusOK, resp)
		}

		ctx := e.Request.Context()

		if card, err := params.Client.GetCard(ctx, customerID); err != nil {
			if params.Logger != nil {
				params.Logger.Error("paddle get card failed", "err", err)
			}
		} else if card != nil {
			resp.Card = &cardResponse{
				Brand:       card.Brand,
				Last4:       card.Last4,
				ExpiryMonth: card.ExpiryMonth,
				ExpiryYear:  card.ExpiryYear,
			}
		}

		if invoices, err := params.Client.ListInvoices(ctx, customerID); err != nil {
			if params.Logger != nil {
				params.Logger.Error("paddle list invoices failed", "err", err)
			}
		} else {
			for _, invoice := range invoices {
				row := invoiceResponse{
					ID:            invoice.ID,
					InvoiceNumber: invoice.InvoiceNumber,
					Status:        invoice.Status,
					Currency:      invoice.CurrencyCode,
					AmountMinor:   invoice.GrandTotalMinor,
				}
				if !invoice.BilledAt.IsZero() {
					row.BilledAt = invoice.BilledAt.Format("2006-01-02T15:04:05Z")
				}
				resp.Invoices = append(resp.Invoices, row)
			}
		}

		return e.JSON(http.StatusOK, resp)
	}
}
