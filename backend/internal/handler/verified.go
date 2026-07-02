package handler

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// EmailNotVerifiedErrorCode is the machine-readable code the frontend branches
// on when an AI-consuming endpoint is blocked pending email verification. It
// mirrors the billing restriction codes (TRIAL_EXHAUSTED, INACTIVE, …) in
// shape: {"error": CODE, "message": …, "next_step": …}.
const EmailNotVerifiedErrorCode = "EMAIL_NOT_VERIFIED"

// RequireVerifiedEmailMiddlewareId names the middleware so the auth-surface
// guardrail can assert which routes bind it.
const RequireVerifiedEmailMiddlewareId = "cognosRequireVerifiedEmail"

type emailVerificationRestriction struct {
	Error    string `json:"error"`
	Message  string `json:"message"`
	NextStep string `json:"next_step,omitempty"`
}

// RequireVerifiedEmail blocks AI-consuming endpoints (completions, image
// generation, model-driven compaction) until the authenticated user has
// verified their email address. It must be bound AFTER apis.RequireAuth().
//
// PocketBase resolves the auth record from the token on every request, so a
// user who verifies mid-session is unblocked immediately with the same token.
// Reading conversations, key setup, billing and account endpoints are
// deliberately NOT gated — verification only fences paid provider calls.
func RequireVerifiedEmail() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id: RequireVerifiedEmailMiddlewareId,
		Func: func(e *core.RequestEvent) error {
			if e.Auth == nil {
				return apis.NewUnauthorizedError("The request requires valid record authorization token.", nil)
			}
			if e.Auth.IsSuperuser() || e.Auth.Verified() {
				return e.Next()
			}
			return e.JSON(http.StatusForbidden, emailVerificationRestriction{
				Error:    EmailNotVerifiedErrorCode,
				Message:  "Verify your email address to start chatting.",
				NextStep: "verify_email",
			})
		},
	}
}
