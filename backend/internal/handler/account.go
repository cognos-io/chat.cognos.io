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
func AccountDelete(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		repo := billing.NewPocketBaseRepo(app)
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

		userRecord, err := app.FindRecordById("users", user.ID)
		if err != nil {
			return apis.NewNotFoundError("User not found", err)
		}

		if err := app.RunInTransaction(func(txApp core.App) error {
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

			return txApp.Delete(userRecord)
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to delete account", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}
