package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Add last_used_at to vault_session_wrap_keys to support an idle-TTL sweep.
// The handler touches it on every read/write of the wrap key, so it tracks the
// last time the persistent session was actually used. A cron sweep deletes
// keys idle past the TTL, bounding an abandoned-but-still-open device now that
// there is no idle auto-logout. Existing rows are backfilled to "now" so they
// are treated as freshly used rather than swept on the first run.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("vault_session_wrap_keys")
		if err != nil {
			return err
		}

		collection.Fields.Add(&core.DateField{
			Name: "last_used_at",
		})

		if err := app.Save(collection); err != nil {
			return err
		}

		// Backfill existing rows so the first sweep does not nuke active sessions.
		records, err := app.FindAllRecords("vault_session_wrap_keys")
		if err != nil {
			return err
		}
		for _, record := range records {
			if record.GetDateTime("last_used_at").IsZero() {
				record.Set("last_used_at", types.NowDateTime())
				if err := app.Save(record); err != nil {
					return err
				}
			}
		}

		return nil
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("vault_session_wrap_keys")
		if err != nil {
			return err
		}

		collection.Fields.RemoveByName("last_used_at")

		return app.Save(collection)
	})
}
