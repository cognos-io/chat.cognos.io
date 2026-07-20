package handler

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
)

// OrgMemberSessionsRevoke handles
// POST /api/v1/orgs/{orgID}/members/{userID}/revoke-sessions.
//
// PocketBase auth is stateless token-based — there is no server-side session
// store to enumerate — so "revoke sessions" means the same token-key rotation
// the logout flow performs (docs/business_processes/logout-token-rotation.md):
// rotating users.tokenKey invalidates EVERY auth token ever issued to the
// member, then the cached vault-session wrap key and MFA trusted devices are
// cleared best-effort.
//
// Deliberate trade-off: tokenKey is per-Account, not per-Organisation, so
// this also signs the member out of their PERSONAL sessions on every device.
// That is acceptable and expected — when an admin needs to cut access (lost
// laptop, offboarding, suspected compromise), completeness wins over the
// inconvenience of the member signing back in.
//
// Access: owner/admin of the organisation; the target must be an ACTIVE
// member (neutral 404 otherwise, matching offboard); admins cannot revoke
// the owner's sessions (mirrors the offboard hierarchy rule).
func OrgMemberSessionsRevoke(app core.App, orgRepo organisations.Repo) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		org, callerRole, err := memberOrganisationOr404(app, e)
		if err != nil {
			return err
		}
		if !callerRole.CanManage() {
			return apis.NewForbiddenError("Only owners and admins can revoke member sessions.", nil)
		}

		targetUserID := e.Request.PathValue("userID")
		if targetUserID == "" {
			return apis.NewNotFoundError("Member not found.", nil)
		}

		targetRole, targetActive, err := orgRepo.ActiveRole(org.ID, targetUserID)
		if err != nil {
			return apis.NewNotFoundError("Member not found.", nil)
		}
		if !targetActive {
			return apis.NewNotFoundError("Member not found.", nil)
		}
		if callerRole == organisations.RoleAdmin && targetRole == organisations.RoleOwner {
			return apis.NewForbiddenError("Admins cannot revoke the organisation owner's sessions.", nil)
		}

		targetUser, err := app.FindRecordById("users", targetUserID)
		if err != nil {
			return apis.NewNotFoundError("Member not found.", nil)
		}

		// Rotate the token key — every previously issued auth token is now
		// invalid (PocketBase signs tokens against the current tokenKey).
		targetUser.RefreshTokenKey()
		if err := app.Save(targetUser); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to revoke sessions.", err)
		}

		// Best-effort cleanup, mirroring logout: drop the cached vault
		// session wrap key and forget MFA-trusted devices so the next sign-in
		// runs the full challenge.
		if record, err := app.FindFirstRecordByData("vault_session_wrap_keys", "user", targetUserID); err == nil {
			if err := app.Delete(record); err != nil {
				app.Logger().Warn("failed to delete vault session wrap key on session revoke", "err", err)
			}
		}
		if err := mfa.NewStore(app).RevokeAllTrustedDevices(targetUserID); err != nil {
			app.Logger().Warn("failed to revoke trusted devices on session revoke", "err", err)
		}

		organisations.RecordAudit(app, org.ID, caller.ID, organisations.AuditMemberSessionsRevoked, targetUserID)

		return e.NoContent(http.StatusNoContent)
	}
}
