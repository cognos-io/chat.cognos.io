package handler

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
)

// authMethodMFA is the auth-method label the MFA-completion endpoints issue
// their token under. It is deliberately NOT "password", so the login
// interceptor (hooks.EnforceMFALogin) lets the freshly minted token through
// instead of re-challenging it.
const authMethodMFA = "mfa"

const maxDeviceLabelLen = 64

// MFAParams carries the dependencies shared by all MFA handlers.
type MFAParams struct {
	App     core.App
	Store   *mfa.Store
	Keyring *mfa.SeedKeyring // nil when no server key is configured (enrolment disabled)
	Issuer  string           // shown in the authenticator app (e.g. "Cognos")
	Logger  *slog.Logger
}

// mfaCompleteRequest is the shared body for the two completion endpoints.
type mfaCompleteRequest struct {
	MFASessionID   string `json:"mfaSessionId"`
	Code           string `json:"code"`
	RememberDevice bool   `json:"rememberDevice"`
	DeviceLabel    string `json:"deviceLabel"`
}

// invalidCredentialError is intentionally generic: it never reveals whether the
// session, the code, or the account state was the problem.
func invalidCredentialError() error {
	return apis.NewApiError(http.StatusUnauthorized, "Invalid or expired verification.", nil)
}

// MFACompleteTOTP completes a login by verifying a TOTP code against an open MFA
// session and, on success, issuing the real auth token.
func MFACompleteTOTP(params MFAParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req mfaCompleteRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		session, user, apiErr := resolveSession(params, req.MFASessionID)
		if apiErr != nil {
			return apiErr
		}
		if params.Keyring == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "MFA is not configured", nil)
		}

		totp, err := params.Store.GetTOTP(user.Id)
		if err != nil || !mfa.TOTPVerified(totp) {
			return invalidCredentialError()
		}

		seed, err := openTOTPSeed(params, totp)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify code", err)
		}

		ok, step, err := mfa.Verify(mfa.TOTPParams{
			Secret:    string(seed),
			Digits:    totp.GetInt("digits"),
			Period:    totp.GetInt("period_seconds"),
			Algorithm: totp.GetString("algorithm"),
		}, strings.TrimSpace(req.Code), time.Now())
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify code", err)
		}

		// Replay protection: a code from the same or an earlier timestep must not
		// be accepted twice (last_accepted_step starts at 0).
		if ok {
			lastAcceptedStep := totp.GetInt("last_accepted_step")
			if lastAcceptedStep < 0 || step <= uint64(lastAcceptedStep) {
				ok = false
			}
		}

		if !ok {
			return params.failAndError(user, session)
		}

		if err := params.Store.RecordTOTPUse(totp, step); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to complete sign-in", err)
		}
		return params.succeed(e, user, session, req)
	}
}

// MFACompleteRecovery completes a login by consuming a one-use recovery code.
func MFACompleteRecovery(params MFAParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var req mfaCompleteRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		session, user, apiErr := resolveSession(params, req.MFASessionID)
		if apiErr != nil {
			return apiErr
		}

		normalized := mfa.NormalizeRecoveryCode(req.Code)
		code, err := params.Store.FindUnusedRecoveryCode(user.Id, normalized)
		if err != nil {
			return params.failAndError(user, session)
		}

		if err := params.Store.MarkRecoveryCodeUsed(code); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to complete sign-in", err)
		}
		return params.succeed(e, user, session, req)
	}
}

// resolveSession validates the session token, loads the user, and enforces the
// per-account MFA lockout. All failure paths return the same generic error.
func resolveSession(params MFAParams, sessionID string) (*core.Record, *core.Record, error) {
	session, err := params.Store.FindActiveSession(sessionID)
	if err != nil {
		return nil, nil, invalidCredentialError()
	}
	user, err := params.App.FindRecordById(mfa.UsersCollection, session.GetString("user"))
	if err != nil {
		return nil, nil, invalidCredentialError()
	}
	if !user.GetBool("mfa_enabled") {
		return nil, nil, invalidCredentialError()
	}
	if mfa.IsMFALocked(user) {
		return nil, nil, apis.NewTooManyRequestsError(
			"Too many incorrect codes. Try again later.", nil)
	}
	return session, user, nil
}

// failAndError records a failed verification against both the session (burn) and
// the account (cooldown), then returns the appropriate error. Burning the
// session or locking the account both surface as 429 so the client knows to
// restart the password step.
func (params MFAParams) failAndError(user, session *core.Record) error {
	burnt, err := params.Store.RecordSessionFailure(session)
	if err != nil && params.Logger != nil {
		params.Logger.Error("mfa: failed to record session failure", "error", err)
	}
	locked, err := params.Store.RecordMFAFailure(user)
	if err != nil && params.Logger != nil {
		params.Logger.Error("mfa: failed to record account failure", "error", err)
	}
	if locked || burnt {
		return apis.NewTooManyRequestsError("Too many incorrect codes. Please sign in again.", nil)
	}
	return invalidCredentialError()
}

// succeed consumes the session, clears failure state, optionally remembers the
// device, and issues the real auth token under the "mfa" method.
func (params MFAParams) succeed(e *core.RequestEvent, user, session *core.Record, req mfaCompleteRequest) error {
	if err := params.Store.ClearMFAFailures(user); err != nil && params.Logger != nil {
		params.Logger.Error("mfa: failed to clear failures", "error", err)
	}
	if err := params.Store.ConsumeSession(session); err != nil {
		return apis.NewApiError(http.StatusInternalServerError, "Failed to complete sign-in", err)
	}

	meta := map[string]any{}
	if req.RememberDevice {
		raw, err := params.Store.CreateTrustedDevice(user.Id, sanitizeDeviceLabel(req.DeviceLabel))
		if err != nil {
			if params.Logger != nil {
				params.Logger.Error("mfa: failed to create trusted device", "error", err)
			}
		} else {
			meta["trustedDeviceToken"] = raw
			meta["trustedDeviceTtlDays"] = int(mfa.TrustedDeviceTTL.Hours() / 24)
		}
	}

	// Issuing under authMethodMFA keeps the login interceptor from re-challenging
	// this token (it only acts on AuthMethod == "password").
	return apis.RecordAuthResponse(e, user, authMethodMFA, meta)
}

// sanitizeDeviceLabel keeps a short, plain label. Angular escapes on render, so
// we only need to bound length and strip control characters.
func sanitizeDeviceLabel(label string) string {
	label = strings.TrimSpace(label)
	label = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, label)
	if len(label) > maxDeviceLabelLen {
		label = label[:maxDeviceLabelLen]
	}
	return label
}
