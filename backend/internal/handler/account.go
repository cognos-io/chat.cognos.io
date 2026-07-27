package handler

import (
	"errors"
	"net/http"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/oauth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// AccountDelete erases the caller's account: their personal conversations
// (messages, secret keys, participants and public shares cascade off each),
// their personal projects, key pairs, personas, preferences and vault wrap
// keys (all cascade off the user record), and finally the user record itself.
//
// Organisation content is never deleted merely because the caller created it.
// Organisation Owners must transfer ownership or dissolve first (409). Ordinary
// members are offboarded first: membership and Project access are revoked and
// affected Projects are marked rotation_pending so remaining Admins can finish
// key rotation.
//
// Financial records (user_billing, balance_transactions, refunds,
// payg_cycle_summaries) reference the user with a non-cascade relation, so
// deleting the user detaches them (the user_id is nulled) rather than removing
// them — they're retained for accounting, per product policy.
//
// Deletion is refused while a paid plan is active: removing the account would
// orphan the Paddle subscription and keep billing a user who no longer exists.
// The user must cancel first. Trial, inactive, or no billing row are all fine.
type accountDeleteRequest struct {
	Password      string `json:"password"`
	TOTPCode      string `json:"totpCode"`
	OAuthStepUpId string `json:"oauthStepUpId"`
}

// AccountDeleteParams carries MFA + optional OAuth step-up dependencies.
type AccountDeleteParams struct {
	MFA   MFAParams
	OAuth *oauth.Store // nil disables the OAuth-only delete path
}

func AccountDelete(params AccountDeleteParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		userRecord, err := params.MFA.App.FindRecordById("users", user.ID)
		if err != nil {
			return apis.NewNotFoundError("User not found", err)
		}

		var req accountDeleteRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		hasCognosPassword := userRecord.GetBool("has_cognos_password")
		switch {
		case !hasCognosPassword:
			// OAuth-only path. Defense in depth: require a live Google link even
			// if has_cognos_password was corrupted — never accept oauthStepUpId
			// for an Account that cannot have completed Google re-auth.
			if params.OAuth == nil {
				return apis.NewApiError(http.StatusServiceUnavailable, "OAuth step-up is not configured", nil)
			}
			if !userHasGoogleProvider(params.MFA.App, userRecord) {
				return apis.NewBadRequestError("Google is not connected to this account", nil)
			}
			if req.OAuthStepUpId == "" {
				return apis.NewBadRequestError("Google re-authentication required", nil)
			}
			if err := params.OAuth.ConsumeStepUpSession(user.ID, req.OAuthStepUpId); err != nil {
				return apis.NewBadRequestError("Invalid or expired Google re-authentication", nil)
			}
		default:
			if !userRecord.ValidatePassword(req.Password) {
				return apis.NewBadRequestError("Incorrect password", nil)
			}
			if userRecord.GetBool("mfa_enabled") {
				totp, err := params.MFA.Store.GetTOTP(user.ID)
				if err != nil || params.MFA.Keyring == nil {
					return apis.NewApiError(http.StatusServiceUnavailable, "MFA is not configured", nil)
				}
				ok, _, err := verifyTOTPRecord(params.MFA, totp, req.TOTPCode)
				if err != nil {
					return apis.NewApiError(http.StatusInternalServerError, "Failed to verify code", err)
				}
				if !ok {
					return apis.NewBadRequestError("Incorrect code", nil)
				}
			}
		}

		repo := billing.NewPocketBaseRepo(params.MFA.App)
		state, err := repo.StateForUser(user.ID)
		if err != nil && !errors.Is(err, billing.ErrStateNotFound) {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load billing state", err)
		}
		if err == nil &&
			(state.PlanType == billing.PlanTypePayG || state.PlanType == billing.PlanTypeUnlimited) {
			return apis.NewApiError(
				http.StatusConflict,
				"Cancel your plan before deleting your account",
				nil,
			)
		}

		orgRepo := organisations.NewPocketBaseRepo(params.MFA.App)
		userOrgs, err := orgRepo.GetForUser(user.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load organisations", err)
		}

		type pendingOffboard struct {
			orgID              string
			affectedProjectIDs []string
		}
		offboards := make([]pendingOffboard, 0, len(userOrgs))
		for _, userOrg := range userOrgs {
			if userOrg.Role == organisations.RoleOwner {
				return apis.NewApiError(
					http.StatusConflict,
					"Transfer ownership or dissolve your Organisation before deleting your account",
					nil,
				)
			}
			affected, collectErr := collectOffboardProjects(params.MFA.App, orgRepo, userOrg.ID, user.ID)
			if collectErr != nil {
				if errors.Is(collectErr, errLastProjectAdmin) {
					return apis.NewApiError(
						http.StatusConflict,
						"Assign another Project Admin before deleting your account",
						nil,
					)
				}
				return apis.NewApiError(
					http.StatusInternalServerError,
					"Failed to resolve Project access",
					collectErr,
				)
			}
			offboards = append(offboards, pendingOffboard{
				orgID:              userOrg.ID,
				affectedProjectIDs: affected,
			})
		}

		if err := params.MFA.App.RunInTransaction(func(txApp core.App) error {
			for _, offboard := range offboards {
				if err := applyOffboardInTx(
					txApp,
					offboard.orgID,
					user.ID,
					offboard.affectedProjectIDs,
				); err != nil {
					return err
				}
				// Record while the Account still exists. Deleting the user
				// detaches actor (optional relation); target keeps the opaque
				// user id so the trail remains content-free but attributable.
				organisations.RecordAudit(
					txApp,
					offboard.orgID,
					user.ID,
					organisations.AuditMemberOffboarded,
					user.ID,
				)
			}

			conversations, err := txApp.FindAllRecords(
				"conversations",
				dbx.HashExp{"creator": user.ID},
			)
			if err != nil {
				return err
			}
			for _, record := range conversations {
				if isOrganisationScopedConversation(txApp, record) {
					continue
				}
				if err := txApp.Delete(record); err != nil {
					return err
				}
			}

			// Personal Projects only. Organisation Projects keep their
			// creator field until the user row is deleted (nulled, not
			// cascaded); content stays with the Organisation.
			projects, err := txApp.FindAllRecords(
				"projects",
				dbx.HashExp{"creator": user.ID},
			)
			if err != nil {
				return err
			}
			for _, record := range projects {
				if record.GetString("organisation") != "" {
					continue
				}
				if err := txApp.Delete(record); err != nil {
					return err
				}
			}

			return txApp.Delete(userRecord)
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete account", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}

// isOrganisationScopedConversation reports whether the conversation belongs to
// an Organisation Project and must survive Account deletion.
func isOrganisationScopedConversation(app core.App, conversation *core.Record) bool {
	projectID := conversation.GetString("project")
	if projectID == "" {
		return false
	}
	project, err := app.FindRecordById("projects", projectID)
	if err != nil {
		return false
	}
	return project.GetString("organisation") != ""
}
