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

// maxLoggedReasonChars caps how much of the user-supplied refund reason ever
// reaches the log stream. The reason is not persisted anywhere (v0 records the
// request in the log only), so this is the sole sink to bound.
const maxLoggedReasonChars = 500

// truncateReasonForLog trims the free-text reason to maxLoggedReasonChars
// runes, appending an ellipsis when truncated. Rune-based so multi-byte
// characters are never split.
func truncateReasonForLog(reason string) string {
	runes := []rune(reason)
	if len(runes) <= maxLoggedReasonChars {
		return reason
	}
	return string(runes[:maxLoggedReasonChars]) + "…"
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
				"user_id", user.Id, "reason", truncateReasonForLog(strings.TrimSpace(req.ReasonText)))
		}

		return e.JSON(http.StatusOK, map[string]string{"status": "received"})
	}
}
