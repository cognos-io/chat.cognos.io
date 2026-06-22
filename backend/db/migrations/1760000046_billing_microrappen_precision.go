package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds sub-rappen ("micro-rappen", 1 rappen = 1_000_000 micro-rappen) precision
// to billing. A single chat turn costs a fraction of one rappen, so rounding
// each turn to whole rappen rounded every debit to 0 — the trial balance never
// depleted and PayG/fair-use ledgers summed to nothing. We now store the exact
// per-turn cost in micro-rappen and only round (up) when money leaves the
// system: the displayed balance and the Paddle charge. The legacy *_rappen
// columns are kept as a human-readable projection.
func init() {
	m.Register(func(app core.App) error {
		userBilling, err := app.FindCollectionByNameOrId("user_billing")
		if err != nil {
			return err
		}
		userBilling.Fields.Add(&core.NumberField{
			Name:    "balance_microrappen",
			OnlyInt: true,
		})
		if err := app.Save(userBilling); err != nil {
			return err
		}
		// Existing balances are untouched by the rounding bug, so the precise
		// balance is simply the rappen balance scaled up.
		if _, err := app.DB().NewQuery(
			"UPDATE user_billing SET balance_microrappen = balance_rappen * 1000000",
		).Execute(); err != nil {
			return err
		}

		transactions, err := app.FindCollectionByNameOrId("balance_transactions")
		if err != nil {
			return err
		}
		for _, name := range []string{
			"user_cost_microrappen",
			"provider_cost_microrappen",
			"amount_microrappen",
			"balance_after_microrappen",
		} {
			transactions.Fields.Add(&core.NumberField{Name: name, OnlyInt: true})
		}
		if err := app.Save(transactions); err != nil {
			return err
		}
		if _, err := app.DB().NewQuery(`
			UPDATE balance_transactions SET
				user_cost_microrappen = user_cost_rappen * 1000000,
				provider_cost_microrappen = provider_cost_rappen * 1000000,
				amount_microrappen = amount_rappen * 1000000,
				balance_after_microrappen = balance_after_rappen * 1000000
		`).Execute(); err != nil {
			return err
		}

		return nil
	}, func(app core.App) error {
		transactions, err := app.FindCollectionByNameOrId("balance_transactions")
		if err != nil {
			return err
		}
		for _, name := range []string{
			"user_cost_microrappen",
			"provider_cost_microrappen",
			"amount_microrappen",
			"balance_after_microrappen",
		} {
			transactions.Fields.RemoveByName(name)
		}
		if err := app.Save(transactions); err != nil {
			return err
		}

		userBilling, err := app.FindCollectionByNameOrId("user_billing")
		if err != nil {
			return err
		}
		userBilling.Fields.RemoveByName("balance_microrappen")
		return app.Save(userBilling)
	})
}
