package handler

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
)

// AccountSessionsRevokeOthers handles
// POST /api/v1/account/sessions/revoke-others.
//
// PocketBase auth is stateless token-based — there is no server-side session
// store to enumerate — so "sign out other devices" means rotating users.tokenKey
// (docs/business_processes/logout-token-rotation.md), which invalidates EVERY
// previously issued auth token, then revoking MFA trusted devices so other
// machines must complete a fresh second factor. This device's stored MFA
// device token is also cleared client-side, so the next sign-in here needs
// TOTP again too — intentional after a compromise response.
//
// Unlike logout / org-admin revoke, the vault session wrap key is kept: this
// device stays unlocked after a page reload, matching "other devices" not
// "lock me out too". The caller receives a fresh auth token minted against the
// new tokenKey so this session continues.
func AccountSessionsRevokeOthers(app core.App, mfaStore *mfa.Store) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		user, err := app.FindRecordById("users", caller.ID)
		if err != nil {
			return apis.NewNotFoundError("User not found", err)
		}

		user.RefreshTokenKey()
		if err := app.Save(user); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to revoke sessions.", err)
		}

		if err := mfaStore.RevokeAllTrustedDevices(caller.ID); err != nil {
			app.Logger().Warn("failed to revoke trusted devices on session revoke", "err", err)
		}

		// Empty auth method matches token refresh: OnRecordAuthRequest only
		// re-challenges AuthMethod == "password".
		return apis.RecordAuthResponse(e, user, "", nil)
	}
}
