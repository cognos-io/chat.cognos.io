package handler

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
)

type billingResponse struct {
	PlanType   billing.PlanType `json:"plan_type"`
	BalanceCHF float64          `json:"balance_chf"`
}

type BillingGetParams struct {
	Logger    *slog.Logger
	StateRepo billing.StateRepo
}

// BillingGet returns the authenticated user's current billing status.
//
// The shape mirrors the contract documented in backend-model-selector.md §6:
// `{ plan_type, balance_chf }`. Trial/PAYG users see their remaining balance;
// unlimited plans see balance_chf=0 (no per-token deduction). Users without a
// billing row are treated as inactive so the frontend can route them to the
// onboarding flow.
func BillingGet(params BillingGetParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		if params.StateRepo == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "Billing is unavailable", nil)
		}

		state, err := params.StateRepo.StateForUser(owner.ID)
		if err != nil {
			if errors.Is(err, billing.ErrStateNotFound) {
				return e.JSON(http.StatusOK, billingResponse{
					PlanType:   billing.PlanTypeInactive,
					BalanceCHF: 0,
				})
			}
			if params.Logger != nil {
				params.Logger.Error("billing state lookup failed", "err", err)
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load billing state", err)
		}

		return e.JSON(http.StatusOK, billingResponse{
			PlanType:   state.PlanType,
			BalanceCHF: float64(state.BalanceRappen) / 100,
		})
	}
}
