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

// PlanMeta describes what a Paddle price activates, so the dashboard can show
// the interval and (when inactive) the previously-held plan.
type PlanMeta struct {
	Plan     billing.PlanType
	Interval string // "monthly" | "annual" | ""
}

type billingResponse struct {
	PlanType billing.PlanType `json:"plan_type"`
	// active | cancels_soon | inactive | trial — drives the dashboard state.
	Status                string           `json:"status"`
	Interval              string           `json:"interval,omitempty"`
	BalanceCHF            float64          `json:"balance_chf"`
	TrialSeedCHF          float64          `json:"trial_seed_chf"`
	CycleEndAt            string           `json:"cycle_end_at,omitempty"`
	CancelAtPeriodEnd     bool             `json:"cancel_at_period_end"`
	RefundEligibleUntilAt string           `json:"refund_eligible_until_at,omitempty"`
	PreviousPlanType      billing.PlanType `json:"previous_plan_type,omitempty"`
	// PaygMinCommitCHF is the PAYG monthly minimum (the cognos-payg Paddle
	// price). Always present so pricing surfaces can show it before purchase;
	// the UI must never hardcode this amount.
	PaygMinCommitCHF float64 `json:"payg_min_commit_chf"`
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
	// PlanByPrice maps a Paddle price id to its plan + interval.
	PlanByPrice map[string]PlanMeta
	// MinCommitRappen is the configured PAYG minimum commit per cycle.
	MinCommitRappen int64
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
					PlanType:         billing.PlanTypeInactive,
					Status:           "inactive",
					PaygMinCommitCHF: minCommitCHF(params.MinCommitRappen),
				})
			}
			if params.Logger != nil {
				params.Logger.Error("billing state lookup failed", "err", err)
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load billing state", err)
		}

		resp := buildBillingResponse(state, params.PlanByPrice)
		resp.PaygMinCommitCHF = minCommitCHF(params.MinCommitRappen)
		return e.JSON(http.StatusOK, resp)
	}
}

// minCommitCHF converts the configured PAYG minimum commit to CHF, falling
// back to the default so the field is never zero when unconfigured.
func minCommitCHF(rappen int64) float64 {
	if rappen <= 0 {
		rappen = billing.DefaultPAYGMinCommitRappen
	}
	return float64(rappen) / 100
}

// buildBillingResponse derives the dashboard view from raw billing state. A
// scheduled cancellation (plan_ends_at set while still on a paid plan) reads as
// "cancels_soon"; once Paddle ends it the plan becomes inactive.
func buildBillingResponse(state billing.State, planByPrice map[string]PlanMeta) billingResponse {
	meta := planByPrice[state.PaddlePriceID]

	resp := billingResponse{
		PlanType:              state.PlanType,
		Interval:              meta.Interval,
		BalanceCHF:            float64(state.BalanceMicroRappen) / (100 * billing.MicroRappenPerRappen),
		TrialSeedCHF:          float64(state.TrialSeedRappen) / 100,
		RefundEligibleUntilAt: formatBillingTime(state.RefundEligibleUntilAt),
	}

	switch state.PlanType {
	case billing.PlanTypeTrial:
		resp.Status = "trial"
	case billing.PlanTypePayG, billing.PlanTypeUnlimited:
		switch {
		case state.PastDue:
			// A failed renewal is the most actionable state — surface it over a
			// pending cancellation so the user fixes their card.
			resp.Status = "past_due"
			resp.CycleEndAt = formatBillingTime(state.CycleEndAt)
		case !state.PlanEndsAt.IsZero():
			resp.Status = "cancels_soon"
			resp.CancelAtPeriodEnd = true
			resp.CycleEndAt = formatBillingTime(state.PlanEndsAt)
		default:
			resp.Status = "active"
			resp.CycleEndAt = formatBillingTime(state.CycleEndAt)
		}
	default:
		resp.Status = "inactive"
		resp.CycleEndAt = formatBillingTime(state.PlanEndsAt)
		resp.PreviousPlanType = meta.Plan
	}

	return resp
}

func formatBillingTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
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

type billingUsageModel struct {
	ModelID string  `json:"model_id"`
	Count   int64   `json:"count"`
	CostCHF float64 `json:"cost_chf"`
}

// billingPaygSoftAlert is the one-per-cycle PAYG heads-up (OP-014). Present
// only on PAYG plans. show=true means the UI should surface the warning;
// Completions are never gated on this field.
type billingPaygSoftAlert struct {
	Show         bool    `json:"show"`
	UsageCHF     float64 `json:"usage_chf"`
	MinCommitCHF float64 `json:"min_commit_chf"`
	OverageCHF   float64 `json:"overage_chf"`
}

type billingUsageResponse struct {
	PeriodStart   string                `json:"period_start"`
	MessageCount  int64                 `json:"message_count"`
	ByModel       []billingUsageModel   `json:"by_model"`
	PaygSoftAlert *billingPaygSoftAlert `json:"payg_soft_alert,omitempty"`
}

type BillingUsageParams struct {
	Logger          *slog.Logger
	StateRepo       billing.StateRepo
	UsageRepo       billing.UsageRepo
	MinCommitRappen int64
}

// BillingUsage returns the user's per-model usage for the current billing
// period. It reads only ledger metadata (model id, counts, cost) — never
// message content — so it's safe despite end-to-end encryption.
func BillingUsage(params BillingUsageParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		if params.UsageRepo == nil || params.StateRepo == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "Billing is unavailable", nil)
		}

		since := usagePeriodStart(params.StateRepo, owner.ID)

		summary, err := params.UsageRepo.UsageSince(owner.ID, since)
		if err != nil {
			if params.Logger != nil {
				params.Logger.Error("billing usage lookup failed", "err", err)
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load usage", err)
		}

		response := billingUsageResponse{
			PeriodStart:  since.UTC().Format(time.RFC3339),
			MessageCount: summary.MessageCount,
			ByModel:      make([]billingUsageModel, 0, len(summary.ByModel)),
		}
		for _, model := range summary.ByModel {
			response.ByModel = append(response.ByModel, billingUsageModel{
				ModelID: model.ModelID,
				Count:   model.Count,
				CostCHF: float64(model.CostMicroRappen) / (100 * billing.MicroRappenPerRappen),
			})
		}

		if state, stateErr := params.StateRepo.StateForUser(owner.ID); stateErr == nil && state.PlanType == billing.PlanTypePayG {
			minCommit := params.MinCommitRappen
			if minCommit <= 0 {
				minCommit = billing.DefaultPAYGMinCommitRappen
			}
			usageRappen := billing.CeilRappenFromMicro(summary.TotalCostMicroRappen())
			alert := billing.EvaluatePAYGSoftAlert(
				state.PlanType,
				usageRappen,
				minCommit,
				state.CycleStartAt,
				state.SoftAlertCycleStartAt,
			)
			response.PaygSoftAlert = &billingPaygSoftAlert{
				Show:         alert.Show,
				UsageCHF:     float64(alert.UsageRappen) / 100,
				MinCommitCHF: float64(alert.MinCommitRappen) / 100,
				OverageCHF:   float64(alert.OverageRappen) / 100,
			}
		}

		return e.JSON(http.StatusOK, response)
	}
}

// usagePeriodStart picks the start of the usage window: the current Paddle
// cycle if subscribed, else the plan start (trial), else a 30-day fallback.
func usagePeriodStart(repo billing.StateRepo, userID string) time.Time {
	state, err := repo.StateForUser(userID)
	if err == nil {
		if !state.CycleStartAt.IsZero() {
			return state.CycleStartAt
		}
		if !state.PlanStartedAt.IsZero() {
			return state.PlanStartedAt
		}
	}
	return time.Now().UTC().AddDate(0, 0, -30)
}

type BillingPaygSoftAlertAckParams struct {
	Logger *slog.Logger
	Repo   billing.SoftAlertAckRepo
}

// BillingPaygSoftAlertAck records that the Account saw the one-per-cycle PAYG
// soft warning for the current billing cycle (OP-014). Idempotent. Never
// affects access — Completions stay open regardless.
func BillingPaygSoftAlertAck(params BillingPaygSoftAlertAckParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		owner := auth.ExtractUser(e)
		if owner == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}
		if params.Repo == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "Billing is unavailable", nil)
		}

		if err := params.Repo.AckPAYGSoftAlert(owner.ID); err != nil {
			if errors.Is(err, billing.ErrStateNotFound) {
				return apis.NewNotFoundError("Billing state not found", err)
			}
			if params.Logger != nil {
				params.Logger.Error("payg soft alert ack failed", "err", err)
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to acknowledge soft alert", err)
		}

		return e.NoContent(http.StatusNoContent)
	}
}
