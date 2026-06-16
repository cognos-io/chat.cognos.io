package handler

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// BillingRefundRequestParams wires the user-facing refund-request handler.
type BillingRefundRequestParams struct {
	Logger *slog.Logger
}

type refundRequest struct {
	ReasonText string `json:"reason_text"`
}

// BillingRefundRequest is the v0 self-serve refund request (spec §12.5). It does
// not issue a refund — refunds are operator-driven via the admin CLI (§7.3).
// For now it records the request in the log for operator follow-up (email
// wiring is post-MVP); a full self-serve flow lands later.
func BillingRefundRequest(params BillingRefundRequestParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		var req refundRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		if params.Logger != nil {
			params.Logger.Info("billing refund requested",
				"user_id", user.Id, "reason", strings.TrimSpace(req.ReasonText))
		}

		return e.JSON(http.StatusOK, map[string]string{"status": "received"})
	}
}
