// Deletes the legacy `models` PocketBase collection.
//
// Originally created by 1711007996_created_models.go as a database-driven
// catalogue. The catalogue is now defined in Go code under
// internal/catalogue/models.go and exposed by GET /api/v1/models — no
// production code path queries the `models` collection anymore. The
// untenanted collection was therefore unreachable scaffolding.
//
// Forward-only: the down migration is intentionally a no-op so a rollback
// will not silently recreate a stale schema.
package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("models")
		if err != nil {
			// Already gone (e.g. fresh DB that never ran the 2024 create).
			return nil
		}
		return app.Delete(collection)
	}, func(app core.App) error {
		return nil
	})
}
