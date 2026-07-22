package billing

import (
	"fmt"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	userBillingCollectionName         = "user_billing"
	orgBillingCollectionName          = "org_billing"
	balanceTransactionsCollectionName = "balance_transactions"
)

type PocketBaseRepo struct {
	app core.App
}

func NewPocketBaseRepo(app core.App) *PocketBaseRepo {
	return &PocketBaseRepo{app: app}
}

func (r *PocketBaseRepo) StateForUser(userID string) (State, error) {
	records, err := r.billingRecordsForUser(r.app, userID, 2)
	if err != nil {
		return State{}, err
	}
	if len(records) == 0 {
		return State{}, ErrStateNotFound
	}
	if len(records) > 1 {
		return State{}, fmt.Errorf("multiple billing states found for user %q", userID)
	}

	planType, err := ParsePlanType(records[0].GetString("plan_type"))
	if err != nil {
		return State{}, err
	}

	record := records[0]
	balanceRappen := int64(record.GetInt("balance_rappen"))
	balanceMicroRappen := int64(record.GetInt("balance_microrappen"))
	// Legacy rows predate the micro-rappen column; derive it from the rappen
	// balance so accounting still works before a balance has moved.
	if balanceMicroRappen == 0 && balanceRappen > 0 {
		balanceMicroRappen = balanceRappen * MicroRappenPerRappen
	}
	return State{
		PlanType:              planType,
		BalanceRappen:         balanceRappen,
		BalanceMicroRappen:    balanceMicroRappen,
		TrialSeedRappen:       int64(record.GetInt("trial_seed_granted_rappen")),
		BillingUserID:         record.Id,
		PaddlePriceID:         record.GetString("paddle_price_id"),
		PlanStartedAt:         record.GetDateTime("plan_started_at").Time().UTC(),
		PlanEndsAt:            record.GetDateTime("plan_ends_at").Time().UTC(),
		CycleStartAt:          record.GetDateTime("paddle_cycle_start_at").Time().UTC(),
		CycleEndAt:            record.GetDateTime("paddle_cycle_end_at").Time().UTC(),
		RefundEligibleUntilAt: record.GetDateTime("refund_eligible_until_at").Time().UTC(),
		PastDue:               record.GetBool("past_due"),
		SoftAlertCycleStartAt: record.GetDateTime("payg_soft_alert_cycle_start_at").Time().UTC(),
	}, nil
}

// StateForOrg loads the Organisation's billing state. It FAILS CLOSED: a
// missing org_billing row (checkout never completed, or the subscription was
// torn down) reads as PlanTypeInactive rather than an error, so the gate
// 402s instead of accidentally proceeding ungated — the personal
// ErrStateNotFound escape hatch (trial not yet bootstrapped) must never apply
// to an org (docs/business_processes/organisation-lifecycle.md).
func (r *PocketBaseRepo) StateForOrg(orgID string) (State, error) {
	records, err := r.app.FindRecordsByFilter(
		orgBillingCollectionName,
		"organisation = {:organisation}",
		"",
		2,
		0,
		dbx.Params{"organisation": orgID},
	)
	if err != nil {
		return State{}, err
	}
	if len(records) == 0 {
		return State{PlanType: PlanTypeInactive}, nil
	}
	if len(records) > 1 {
		return State{}, fmt.Errorf("multiple billing states found for organisation %q", orgID)
	}

	record := records[0]
	planType, err := ParsePlanType(record.GetString("plan_type"))
	if err != nil {
		return State{}, err
	}

	return State{
		PlanType: planType,
		// Orgs are balance-free: pooled PAYG only, nothing to deplete.
		BillingUserID: record.Id,
		PaddlePriceID: record.GetString("paddle_price_id"),
		CycleStartAt:  record.GetDateTime("paddle_cycle_start_at").Time().UTC(),
		CycleEndAt:    record.GetDateTime("paddle_cycle_end_at").Time().UTC(),
		PastDue:       record.GetBool("past_due"),
	}, nil
}

// StateForContext resolves the billing subject for a completion from the
// conversation's scope — conversation → project → organisation, a fixed
// chain of at most four primary-key lookups (never per-row fan-out):
//
//   - no conversation, standalone conversation, or personal Project →
//     the caller's personal state (StateForUser), Subject user.
//   - org-owned Project → the Organisation's state (StateForOrg), Subject
//     org — REGARDLESS of who is typing. A missing org_billing row resolves
//     to inactive; the resolver NEVER falls back to the member's personal
//     balance (docs/business_processes/organisation-lifecycle.md).
//
// Callers must have already authorised the caller against the conversation;
// this resolver only decides who pays.
func (r *PocketBaseRepo) StateForContext(userID, conversationID string) (ResolvedState, error) {
	personal := func() (ResolvedState, error) {
		state, err := r.StateForUser(userID)
		return ResolvedState{Subject: UserSubject(userID), State: state}, err
	}

	if conversationID == "" {
		return personal()
	}

	conversation, err := r.app.FindRecordById("conversations", conversationID)
	if err != nil {
		// Unknown conversation: the handler treats the request as stateless,
		// so billing follows the caller personally, as before orgs existed.
		return personal()
	}
	projectID := conversation.GetString("project")
	if projectID == "" {
		return personal()
	}

	project, err := r.app.FindRecordById("projects", projectID)
	if err != nil {
		return personal()
	}
	orgID := project.GetString("organisation")
	if orgID == "" {
		return personal()
	}

	state, err := r.StateForOrg(orgID)
	if err != nil {
		return ResolvedState{Subject: OrgSubject(orgID)}, err
	}

	resolved := ResolvedState{Subject: OrgSubject(orgID), State: state}
	// The name is operational metadata for restriction copy; a dangling
	// organisation relation still fails closed with the state above.
	if organisation, err := r.app.FindRecordById("organisations", orgID); err == nil {
		resolved.OrganisationName = organisation.GetString("name")
	}
	return resolved, nil
}

func (r *PocketBaseRepo) EnsureTrialState(userID string, seedRappen int64) error {
	return r.app.RunInTransaction(func(txApp core.App) error {
		records, err := r.billingRecordsForUser(txApp, userID, 1)
		if err != nil {
			return err
		}
		if len(records) > 0 {
			return nil
		}

		collection, err := txApp.FindCollectionByNameOrId(userBillingCollectionName)
		if err != nil {
			return err
		}

		seed := DefaultTrialStateSeed(time.Now().UTC(), seedRappen)
		record := core.NewRecord(collection)
		record.Set("user_id", userID)
		record.Set("plan_type", string(seed.PlanType))
		record.Set("balance_rappen", seed.BalanceRappen)
		record.Set("balance_microrappen", seed.BalanceRappen*MicroRappenPerRappen)
		record.Set("trial_seed_granted_rappen", seed.TrialSeedGrantedRappen)
		record.Set("plan_started_at", seed.PlanStartedAt)
		return txApp.Save(record)
	})
}

func (r *PocketBaseRepo) RecordUsage(record UsageRecord) error {
	return r.app.RunInTransaction(func(txApp core.App) error {
		// Org-attributed usage never mutates any balance: orgs are pure
		// pooled PAYG (no trial, no prepaid credit) and the acting member's
		// personal balance must stay untouched. The OrganisationID guard is
		// belt and braces — an org record's PlanType is always payg.
		if record.OrganisationID == "" &&
			record.PlanType == PlanTypeTrial && record.BalanceAfterMicroRappen != nil {
			billingRecord, err := txApp.FindFirstRecordByData(userBillingCollectionName, "user_id", record.UserID)
			if err != nil {
				return err
			}

			// Re-read the CURRENT balance inside the transaction and apply the
			// usage cost as a delta. The BalanceAfterMicroRappen the caller
			// precomputed comes from a state snapshot taken before the provider
			// call — two concurrent completions carrying the same snapshot would
			// otherwise each persist the same absolute value and lose one
			// deduction.
			currentMicro := int64(billingRecord.GetInt("balance_microrappen"))
			currentRappen := int64(billingRecord.GetInt("balance_rappen"))
			// Legacy rows predate the micro-rappen column; derive it from the
			// rappen balance (mirrors StateForUser).
			if currentMicro == 0 && currentRappen > 0 {
				currentMicro = currentRappen * MicroRappenPerRappen
			}
			balanceAfterMicro := currentMicro - record.UserCostMicroRappen
			balanceAfterRappen := FloorRappenFromMicro(balanceAfterMicro)

			// The ledger row records the actually-applied before/after values.
			record.BalanceAfterMicroRappen = &balanceAfterMicro
			record.BalanceAfterRappen = &balanceAfterRappen

			// balance_microrappen is the precise source of truth; balance_rappen
			// is the floored display projection (never overstates remaining).
			billingRecord.Set("balance_microrappen", balanceAfterMicro)
			billingRecord.Set("balance_rappen", balanceAfterRappen)
			if err := txApp.Save(billingRecord); err != nil {
				return err
			}
		}

		collection, err := txApp.FindCollectionByNameOrId(balanceTransactionsCollectionName)
		if err != nil {
			return err
		}

		transactionRecord := core.NewRecord(collection)
		transactionRecord.Set("user_id", record.UserID)
		if record.OrganisationID != "" {
			transactionRecord.Set("organisation", record.OrganisationID)
		}
		transactionRecord.Set("occurred_at", time.Now().UTC())
		transactionRecord.Set("type", record.Type)
		transactionRecord.Set("amount_rappen", record.AmountRappen)
		transactionRecord.Set("event_id", record.EventID)
		transactionRecord.Set("plan_type", string(record.PlanType))
		transactionRecord.Set("model_id", record.ModelID)
		transactionRecord.Set("provider_cost_rappen", record.ProviderCostRappen)
		transactionRecord.Set("user_cost_rappen", record.UserCostRappen)
		transactionRecord.Set("amount_microrappen", record.AmountMicroRappen)
		transactionRecord.Set("provider_cost_microrappen", record.ProviderCostMicroRappen)
		transactionRecord.Set("user_cost_microrappen", record.UserCostMicroRappen)
		transactionRecord.Set("fx_rate_usd_chf", record.FXRateUSDCHF)
		transactionRecord.Set("input_tokens", record.InputTokens)
		transactionRecord.Set("output_tokens", record.OutputTokens)
		transactionRecord.Set("search_count", record.SearchCount)
		transactionRecord.Set("operation_type", string(record.OperationType))
		transactionRecord.Set("generated_image_count", record.GeneratedImageCount)
		transactionRecord.Set("description", record.ModelID)
		if record.BalanceAfterRappen != nil {
			transactionRecord.Set("balance_after_rappen", *record.BalanceAfterRappen)
		}
		if record.BalanceAfterMicroRappen != nil {
			transactionRecord.Set("balance_after_microrappen", *record.BalanceAfterMicroRappen)
		}

		return txApp.Save(transactionRecord)
	})
}

func (r *PocketBaseRepo) billingRecordsForUser(app core.App, userID string, limit int) ([]*core.Record, error) {
	return app.FindRecordsByFilter(
		userBillingCollectionName,
		"user_id = {:user_id}",
		"",
		limit,
		0,
		dbx.Params{"user_id": userID},
	)
}

// AckPAYGSoftAlert stamps payg_soft_alert_cycle_start_at with the Account's
// current paddle cycle start so the soft warning stays quiet for this cycle.
// Idempotent: re-acking the same cycle is a no-op. Returns ErrStateNotFound
// when there is no billing row.
func (r *PocketBaseRepo) AckPAYGSoftAlert(userID string) error {
	records, err := r.billingRecordsForUser(r.app, userID, 2)
	if err != nil {
		return err
	}
	if len(records) == 0 {
		return ErrStateNotFound
	}
	if len(records) > 1 {
		return fmt.Errorf("multiple billing states found for user %q", userID)
	}

	record := records[0]
	cycleStart := record.GetDateTime("paddle_cycle_start_at").Time().UTC()
	if cycleStart.IsZero() {
		// No cycle window yet (e.g. trial) — nothing to acknowledge.
		return nil
	}

	already := record.GetDateTime("payg_soft_alert_cycle_start_at").Time().UTC()
	if already.Equal(cycleStart) {
		return nil
	}

	record.Set("payg_soft_alert_cycle_start_at", cycleStart)
	return r.app.Save(record)
}
