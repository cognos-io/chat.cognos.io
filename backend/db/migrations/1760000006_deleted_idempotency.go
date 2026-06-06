package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("idempotency")
		if err != nil {
			return nil
		}

		return app.Delete(collection)
	}, func(app core.App) error {
		return nil
	})
}
