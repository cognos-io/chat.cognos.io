package hooks

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
)

// EnforceMFALogin intercepts successful password sign-ins for users who have
// MFA enabled and withholds the auth token until a second factor is supplied.
//
// Why OnRecordAuthRequest (and not OnRecordAuthWithPasswordRequest): this hook
// is the only place that runs *before* the token is serialized into the
// response, so returning here suppresses the token. It also fires for OAuth2,
// OTP, and token refresh — but only genuine password sign-ins carry
// AuthMethod == "password". Refresh passes an empty AuthMethod, and our own MFA
// completion endpoints issue their token under a non-password method, so both
// pass straight through and are never re-challenged. See
// docs/specs/mfa-and-passkeys.md ("Load-bearing constraint").
//
// On interception we write a distinct mfa_required 401 (not a bare 401, so the
// frontend can branch to the code step instead of treating it as session
// expiry) and return without issuing the token. We must write the body
// ourselves rather than via NewApiError: PocketBase sanitises ApiError.Data and
// would mangle the session id.
func EnforceMFALogin(app core.App, store *mfa.Store) {
	app.OnRecordAuthRequest("users").BindFunc(func(e *core.RecordAuthRequestEvent) error {
		// Only genuine password sign-ins are candidates for an MFA challenge.
		if e.AuthMethod != core.MFAMethodPassword {
			return e.Next()
		}

		user := e.Record
		if user == nil || !user.GetBool("mfa_enabled") {
			return e.Next()
		}

		// A previously-verified, still-valid device skips the second factor.
		deviceToken := e.Request.Header.Get(mfa.MFADeviceHeader)
		if store.TrustedDeviceValid(user.Id, deviceToken) {
			return e.Next()
		}

		// Challenge: open a short-lived session and ask for a code. Suppress the
		// token by not calling e.Next().
		rawSession, err := store.CreateAuthSession(user.Id)
		if err != nil {
			return err
		}

		return e.JSON(http.StatusUnauthorized, map[string]any{
			"code":         "mfa_required",
			"mfaSessionId": rawSession,
		})
	})
}
