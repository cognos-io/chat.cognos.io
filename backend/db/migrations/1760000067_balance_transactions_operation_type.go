package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds operation_type and generated_image_count to balance_transactions. The
// ledger's documented invariant is that every figure on a row is independently
// re-derivable and auditable — but UsageRecord.OperationType (text vs
// image_generation) and UsageRecord.GeneratedImageCount were computed by
// billing.BuildUsageRecord and carried on the in-memory record without ever
// being persisted (repo.go only wrote search_count). That made an image charge
// indistinguishable from a text charge in the ledger. Both default to their
// zero value (operation_type "", generated_image_count 0) on pre-existing rows,
// which are all text completions.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("balance_transactions")
		if err != nil {
			return err
		}

		collection.Fields.Add(&core.TextField{
			Name: "operation_type",
		})
		collection.Fields.Add(&core.NumberField{
			Name:    "generated_image_count",
			OnlyInt: true,
		})
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("balance_transactions")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("operation_type")
		collection.Fields.RemoveByName("generated_image_count")
		return app.Save(collection)
	})
}
