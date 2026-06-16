package billing

import (
	"fmt"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	userBillingCollectionName         = "user_billing"
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
	return State{
		PlanType:              planType,
		BalanceRappen:         int64(record.GetInt("balance_rappen")),
		TrialSeedRappen:       int64(record.GetInt("trial_seed_granted_rappen")),
		BillingUserID:         record.Id,
		PaddlePriceID:         record.GetString("paddle_price_id"),
		PlanStartedAt:         record.GetDateTime("plan_started_at").Time().UTC(),
		PlanEndsAt:            record.GetDateTime("plan_ends_at").Time().UTC(),
		CycleStartAt:          record.GetDateTime("paddle_cycle_start_at").Time().UTC(),
		CycleEndAt:            record.GetDateTime("paddle_cycle_end_at").Time().UTC(),
		RefundEligibleUntilAt: record.GetDateTime("refund_eligible_until_at").Time().UTC(),
		PastDue:               record.GetBool("past_due"),
	}, nil
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
		record.Set("trial_seed_granted_rappen", seed.TrialSeedGrantedRappen)
		record.Set("plan_started_at", seed.PlanStartedAt)
		return txApp.Save(record)
	})
}

func (r *PocketBaseRepo) RecordUsage(record UsageRecord) error {
	return r.app.RunInTransaction(func(txApp core.App) error {
		if record.PlanType == PlanTypeTrial && record.BalanceAfterRappen != nil {
			billingRecord, err := txApp.FindFirstRecordByData(userBillingCollectionName, "user_id", record.UserID)
			if err != nil {
				return err
			}
			billingRecord.Set("balance_rappen", *record.BalanceAfterRappen)
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
		transactionRecord.Set("occurred_at", time.Now().UTC())
		transactionRecord.Set("type", record.Type)
		transactionRecord.Set("amount_rappen", record.AmountRappen)
		transactionRecord.Set("event_id", record.EventID)
		transactionRecord.Set("plan_type", string(record.PlanType))
		transactionRecord.Set("model_id", record.ModelID)
		transactionRecord.Set("provider_cost_rappen", record.ProviderCostRappen)
		transactionRecord.Set("user_cost_rappen", record.UserCostRappen)
		transactionRecord.Set("fx_rate_usd_chf", record.FXRateUSDCHF)
		transactionRecord.Set("input_tokens", record.InputTokens)
		transactionRecord.Set("output_tokens", record.OutputTokens)
		transactionRecord.Set("description", record.ModelID)
		if record.BalanceAfterRappen != nil {
			transactionRecord.Set("balance_after_rappen", *record.BalanceAfterRappen)
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
