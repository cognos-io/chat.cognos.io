package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
)

// These endpoints all require an authenticated session (apis.RequireAuth). They
// manage a user's own MFA enrolment and trusted devices.

type mfaStatusResponse struct {
	Enabled                bool   `json:"enabled"`
	EnrolledAt             string `json:"enrolledAt,omitempty"`
	PendingEnrolment       bool   `json:"pendingEnrolment"`
	RecoveryCodesRemaining int    `json:"recoveryCodesRemaining"`
}

// MFAStatus reports the caller's current MFA state for the settings page.
func MFAStatus(params MFAParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		resp := mfaStatusResponse{Enabled: user.GetBool("mfa_enabled")}
		if enrolledAt := user.GetDateTime("mfa_enrolled_at"); !enrolledAt.IsZero() {
			resp.EnrolledAt = enrolledAt.String()
		}

		if totp, err := params.Store.GetTOTP(user.Id); err == nil {
			resp.PendingEnrolment = !mfa.TOTPVerified(totp)
		}
		if remaining, err := params.Store.CountUnusedRecoveryCodes(user.Id); err == nil {
			resp.RecoveryCodesRemaining = remaining
		}

		return e.JSON(http.StatusOK, resp)
	}
}

type enrolRequest struct {
	Password string `json:"password"`
}

type enrolResponse struct {
	Secret     string `json:"secret"`     // base32, for manual entry
	OTPAuthURL string `json:"otpauthUrl"` // for the QR code
}

// MFAEnrolTOTP starts enrolment: it re-checks the password (so a borrowed,
// already-unlocked session can't silently add a factor), then issues a fresh,
// not-yet-active TOTP secret. MFA is not enabled until MFAConfirmTOTP.
func MFAEnrolTOTP(params MFAParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		if params.Keyring == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "MFA is not configured", nil)
		}

		var req enrolRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if !user.ValidatePassword(req.Password) {
			return apis.NewBadRequestError("Incorrect password", nil)
		}
		if user.GetBool("mfa_enabled") {
			return apis.NewApiError(http.StatusConflict, "MFA is already enabled", nil)
		}

		key, err := mfa.GenerateSecret(params.Issuer, user.Email())
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to start enrolment", err)
		}

		ct, nonce, err := params.Keyring.Seal([]byte(key.Secret()))
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to start enrolment", err)
		}
		if _, err := params.Store.UpsertEnrolment(user.Id, ct, nonce, params.Keyring.KeyID()); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to start enrolment", err)
		}

		return e.JSON(http.StatusOK, enrolResponse{
			Secret:     key.Secret(),
			OTPAuthURL: key.URL(),
		})
	}
}

type confirmRequest struct {
	Code string `json:"code"`
}

type recoveryCodesResponse struct {
	RecoveryCodes []string `json:"recoveryCodes"`
}

// MFAConfirmTOTP verifies the first code, activates MFA, and returns a fresh set
// of recovery codes (shown once).
func MFAConfirmTOTP(params MFAParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		if params.Keyring == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "MFA is not configured", nil)
		}

		var req confirmRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		totp, err := params.Store.GetTOTP(user.Id)
		if err != nil {
			return apis.NewBadRequestError("Start enrolment first", nil)
		}

		// Note: confirmation does NOT advance last_accepted_step. Replay
		// protection guards the unauthenticated login path; burning the timestep
		// here would wrongly reject a genuine login made in the same 30s window
		// right after enrolling.
		ok, _, err := verifyTOTPRecord(params, totp, req.Code)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify code", err)
		}
		if !ok {
			return apis.NewBadRequestError("Incorrect code", nil)
		}

		if err := params.Store.MarkTOTPVerified(totp); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to confirm enrolment", err)
		}

		plain, hashes := mfa.GenerateRecoveryCodes(mfa.RecoveryCodeCount)
		if err := params.Store.ReplaceRecoveryCodes(user.Id, hashes); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to generate recovery codes", err)
		}

		user.Set("mfa_enabled", true)
		user.Set("mfa_enrolled_at", time.Now())
		if err := params.App.Save(user); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to enable MFA", err)
		}

		return e.JSON(http.StatusOK, recoveryCodesResponse{RecoveryCodes: plain})
	}
}

type disableRequest struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

// MFADisableTOTP turns MFA off. It requires BOTH the current password and a
// current code, then clears the credential, recovery codes, and every trusted
// device.
func MFADisableTOTP(params MFAParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		if !user.GetBool("mfa_enabled") {
			return e.JSON(http.StatusOK, map[string]any{"enabled": false})
		}

		var req disableRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if !user.ValidatePassword(req.Password) {
			return apis.NewBadRequestError("Incorrect password", nil)
		}

		totp, err := params.Store.GetTOTP(user.Id)
		if err != nil || params.Keyring == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "MFA is not configured", nil)
		}
		ok, _, err := verifyTOTPRecord(params, totp, req.Code)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify code", err)
		}
		if !ok {
			return apis.NewBadRequestError("Incorrect code", nil)
		}

		if err := params.Store.DisableTOTP(totp); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to disable MFA", err)
		}
		if err := params.Store.ReplaceRecoveryCodes(user.Id, nil); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to disable MFA", err)
		}
		if err := params.Store.RevokeAllTrustedDevices(user.Id); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to disable MFA", err)
		}

		user.Set("mfa_enabled", false)
		user.Set("mfa_enrolled_at", nil)
		if err := params.App.Save(user); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to disable MFA", err)
		}

		return e.JSON(http.StatusOK, map[string]any{"enabled": false})
	}
}

// MFARegenerateRecoveryCodes issues a fresh set after verifying a current code.
// Regeneration also revokes trusted devices (a security-sensitive reset).
func MFARegenerateRecoveryCodes(params MFAParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		if !user.GetBool("mfa_enabled") || params.Keyring == nil {
			return apis.NewBadRequestError("MFA is not enabled", nil)
		}

		var req confirmRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		totp, err := params.Store.GetTOTP(user.Id)
		if err != nil {
			return apis.NewBadRequestError("MFA is not enabled", nil)
		}
		// As with confirmation, do not advance last_accepted_step here (this is an
		// authenticated management action, not the login path).
		ok, _, err := verifyTOTPRecord(params, totp, req.Code)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to verify code", err)
		}
		if !ok {
			return apis.NewBadRequestError("Incorrect code", nil)
		}

		plain, hashes := mfa.GenerateRecoveryCodes(mfa.RecoveryCodeCount)
		if err := params.Store.ReplaceRecoveryCodes(user.Id, hashes); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to regenerate codes", err)
		}
		if err := params.Store.RevokeAllTrustedDevices(user.Id); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to regenerate codes", err)
		}

		return e.JSON(http.StatusOK, recoveryCodesResponse{RecoveryCodes: plain})
	}
}

type trustedDeviceView struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
	ExpiresAt  string `json:"expiresAt"`
}

// MFAListTrustedDevices returns the caller's active trusted devices.
func MFAListTrustedDevices(params MFAParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		records, err := params.Store.ListActiveTrustedDevices(user.Id)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load devices", err)
		}

		views := make([]trustedDeviceView, 0, len(records))
		for _, record := range records {
			view := trustedDeviceView{
				ID:        record.Id,
				Label:     record.GetString("label"),
				CreatedAt: record.GetDateTime("created").String(),
				ExpiresAt: record.GetDateTime("expires_at").String(),
			}
			if last := record.GetDateTime("last_used_at"); !last.IsZero() {
				view.LastUsedAt = last.String()
			}
			views = append(views, view)
		}

		return e.JSON(http.StatusOK, map[string]any{"devices": views})
	}
}

// MFARevokeTrustedDevice revokes one of the caller's trusted devices by id.
func MFARevokeTrustedDevice(params MFAParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := e.Auth
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		id := strings.TrimSpace(e.Request.PathValue("id"))
		if id == "" {
			return apis.NewBadRequestError("Missing device id", nil)
		}

		switch err := params.Store.RevokeTrustedDevice(user.Id, id); {
		case err == nil:
			return e.NoContent(http.StatusNoContent)
		case err == mfa.ErrNotFound:
			return apis.NewNotFoundError("Device not found", nil)
		default:
			return apis.NewApiError(http.StatusInternalServerError, "Failed to revoke device", err)
		}
	}
}

// openTOTPSeed decrypts a TOTP row's seed and lazily re-seals it under the
// primary key when the row was encrypted with a retired key.
func openTOTPSeed(params MFAParams, totp *core.Record) ([]byte, error) {
	result, err := params.Keyring.OpenAndReseal(
		totp.GetString("secret_ciphertext"),
		totp.GetString("secret_nonce"),
		totp.GetString("secret_key_id"),
	)
	if err != nil {
		return nil, err
	}
	if result.NeedsReseal {
		if err := params.Store.ResealTOTPSecret(totp, result.Ciphertext, result.Nonce, result.KeyID); err != nil && params.Logger != nil {
			params.Logger.Error("mfa: failed to reseal TOTP seed after key rotation", "error", err)
		}
	}
	return result.Seed, nil
}

// verifyTOTPRecord opens the sealed seed in a TOTP row and verifies a code
// against it, enforcing the same replay guard as login completion.
func verifyTOTPRecord(params MFAParams, totp *core.Record, code string) (bool, uint64, error) {
	seed, err := openTOTPSeed(params, totp)
	if err != nil {
		return false, 0, err
	}
	ok, step, err := mfa.Verify(mfa.TOTPParams{
		Secret:    string(seed),
		Digits:    totp.GetInt("digits"),
		Period:    totp.GetInt("period_seconds"),
		Algorithm: totp.GetString("algorithm"),
	}, strings.TrimSpace(code), time.Now())
	if err != nil {
		return false, 0, err
	}
	if ok {
		lastAcceptedStep := totp.GetInt("last_accepted_step")
		if lastAcceptedStep < 0 || step <= uint64(lastAcceptedStep) {
			return false, 0, nil
		}
	}
	return ok, step, nil
}
