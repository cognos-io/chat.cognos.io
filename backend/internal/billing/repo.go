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
	records, err := r.app.FindRecordsByFilter(
		userBillingCollectionName,
		"user_id = {:user_id}",
		"",
		2,
		0,
		dbx.Params{"user_id": userID},
	)
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

	return State{
		PlanType:      planType,
		BalanceRappen: int64(records[0].GetInt("balance_rappen")),
		BillingUserID: records[0].Id,
	}, nil
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
