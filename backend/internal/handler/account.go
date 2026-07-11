package handler

import (
	"errors"
	"net/http"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// AccountDelete erases the caller's account: their conversations (messages,
// secret keys, participants and public shares cascade off each), their key
// pairs, personas, preferences and vault wrap keys (all cascade off the user
// record), and finally the user record itself.
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
	Password string `json:"password"`
	TOTPCode string `json:"totpCode"`
}

func AccountDelete(params MFAParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		userRecord, err := params.App.FindRecordById("users", user.ID)
		if err != nil {
			return apis.NewNotFoundError("User not found", err)
		}

		var req accountDeleteRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}
		if !userRecord.ValidatePassword(req.Password) {
			return apis.NewBadRequestError("Incorrect password", nil)
		}
		if userRecord.GetBool("mfa_enabled") {
			totp, err := params.Store.GetTOTP(user.ID)
			if err != nil || params.Cipher == nil {
				return apis.NewApiError(http.StatusServiceUnavailable, "MFA is not configured", nil)
			}
			ok, _, err := verifyTOTPRecord(params, totp, req.TOTPCode)
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to verify code", err)
			}
			if !ok {
				return apis.NewBadRequestError("Incorrect code", nil)
			}
		}

		repo := billing.NewPocketBaseRepo(params.App)
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

		if err := params.App.RunInTransaction(func(txApp core.App) error {
			conversations, err := txApp.FindAllRecords(
				"conversations",
				dbx.HashExp{"creator": user.ID},
			)
			if err != nil {
				return err
			}
			for _, record := range conversations {
				if err := txApp.Delete(record); err != nil {
					return err
				}
			}

			// Projects the user created are removed too — their
			// participants and key wrappings cascade off each project. (A
			// later sharing phase will need to reassign ownership instead of
			// hard-deleting shared projects; today every project is
			// single-owner.)
			projects, err := txApp.FindAllRecords(
				"projects",
				dbx.HashExp{"creator": user.ID},
			)
			if err != nil {
				return err
			}
			for _, record := range projects {
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
