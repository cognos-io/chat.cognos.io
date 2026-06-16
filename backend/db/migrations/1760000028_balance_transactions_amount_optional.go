package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Makes balance_transactions.amount_rappen non-required so a legitimate zero
// amount persists. PocketBase treats a required number field's 0 as "blank", so
// every `unlimited` usage row (amount_rappen = 0 by design — cost is recorded in
// user_cost_rappen) and any zero-cost rounding row was being rejected and
// silently dropped. Without this the fair-use monitor (spec §8) and the
// Unlimited usage dashboard have no data to read.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("balance_transactions")
		if err != nil {
			return err
		}
		field, ok := collection.Fields.GetByName("amount_rappen").(*core.NumberField)
		if !ok {
			return fmt.Errorf("amount_rappen is not a number field")
		}
		field.Required = false
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("balance_transactions")
		if err != nil {
			return err
		}
		field, ok := collection.Fields.GetByName("amount_rappen").(*core.NumberField)
		if !ok {
			return fmt.Errorf("amount_rappen is not a number field")
		}
		field.Required = true
		return app.Save(collection)
	})
}
