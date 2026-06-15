package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
)

const defaultBillingTransactionLimit = 50

type billingResponse struct {
	PlanType     billing.PlanType `json:"plan_type"`
	BalanceCHF   float64          `json:"balance_chf"`
	TrialSeedCHF float64          `json:"trial_seed_chf"`
}

type billingTransaction struct {
	ID              string   `json:"id"`
	OccurredAt      string   `json:"occurred_at"`
	Type            string   `json:"type"`
	AmountCHF       float64  `json:"amount_chf"`
	BalanceAfterCHF *float64 `json:"balance_after_chf,omitempty"`
	EventID         string   `json:"event_id,omitempty"`
	ModelID         string   `json:"model_id,omitempty"`
	Description     string   `json:"description,omitempty"`
}

type billingTransactionsResponse struct {
	Transactions []billingTransaction `json:"transactions"`
}

type BillingGetParams struct {
	Logger    *slog.Logger
	StateRepo billing.StateRepo
}

type BillingTransactionsParams struct {
	Logger           *slog.Logger
	TransactionsRepo billing.TransactionsRepo
	Limit            int
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
			PlanType:     state.PlanType,
			BalanceCHF:   float64(state.BalanceRappen) / 100,
			TrialSeedCHF: float64(state.TrialSeedRappen) / 100,
		})
	}
}

// BillingTransactions returns the most recent ledger entries for the
// authenticated user. Amounts are exposed in CHF — the integer rappen field is
// kept server-side to preserve the invariant that the billing API never leaks
// internal accounting units to clients.
func BillingTransactions(params BillingTransactionsParams) func(e *core.RequestEvent) error {
	limit := params.Limit
	if limit <= 0 {
		limit = defaultBillingTransactionLimit
	}

	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		if params.TransactionsRepo == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "Billing is unavailable", nil)
		}

		transactions, err := params.TransactionsRepo.TransactionsForUser(owner.ID, limit)
		if err != nil {
			if params.Logger != nil {
				params.Logger.Error("billing transactions lookup failed", "err", err)
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load billing transactions", err)
		}

		response := billingTransactionsResponse{
			Transactions: make([]billingTransaction, 0, len(transactions)),
		}
		for _, txn := range transactions {
			entry := billingTransaction{
				ID:          txn.ID,
				OccurredAt:  txn.OccurredAt.UTC().Format(time.RFC3339),
				Type:        txn.Type,
				AmountCHF:   float64(txn.AmountRappen) / 100,
				EventID:     txn.EventID,
				ModelID:     txn.ModelID,
				Description: txn.Description,
			}
			if txn.BalanceAfterRappen != nil {
				balanceCHF := float64(*txn.BalanceAfterRappen) / 100
				entry.BalanceAfterCHF = &balanceCHF
			}
			response.Transactions = append(response.Transactions, entry)
		}

		return e.JSON(http.StatusOK, response)
	}
}
