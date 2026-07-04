package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds search_count to balance_transactions. The ledger's documented invariant
// is that every figure on a row is independently re-derivable — but
// UsageRecord.SearchCount (the number of provider web searches a completion
// performed, used to apply the per-search floor fee, see
// billing.Service.WebSearchFloorMicroRappen) was computed and carried on the
// in-memory record without ever being persisted, so a web-search floor fee on
// a row could not be re-derived from what was stored. Defaults to 0 (no
// search performed), matching every pre-existing row.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("balance_transactions")
		if err != nil {
			return err
		}

		collection.Fields.Add(&core.NumberField{
			Name:    "search_count",
			OnlyInt: true,
		})
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("balance_transactions")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("search_count")
		return app.Save(collection)
	})
}
