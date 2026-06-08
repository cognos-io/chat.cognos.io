package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Add a monotonically-increasing key_version field on the conversations
// collection. The field is the durable handle the access-key wrapping
// will eventually pivot on — every conversation_secret_keys row will be
// stamped with the conversation's key_version, and rotation (e.g. on
// participant removal) bumps the version + invalidates old wrapped keys.
//
// This migration only introduces the column with a default of 1 and
// backfills existing rows. No callers consume it yet; that wiring lands
// alongside the rotation path. Keeping the schema move small makes the
// rotation slice easier to review on its own.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversations")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "numkeyver01",
			"name": "key_version",
			"type": "number",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"min": 1, "max": null, "noDecimal": true}
		}`); err != nil {
			return err
		}

		if err := app.Save(collection); err != nil {
			return err
		}

		// Backfill any pre-existing conversations to key_version = 1 so
		// future reads can rely on the field being populated everywhere.
		_, err = app.DB().
			NewQuery("UPDATE conversations SET key_version = {:v} WHERE key_version IS NULL OR key_version = 0").
			Bind(dbx.Params{"v": 1}).
			Execute()
		return err
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversations")
		if err != nil {
			return nil
		}
		collection.Fields.RemoveById("numkeyver01")
		return app.Save(collection)
	})
}
