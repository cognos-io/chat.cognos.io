package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// The original personas collection was imported with only `user` and `data`
// fields, so the table had no `created`/`updated` columns. PersonasList sorts
// by `-updated` and the API serialises both timestamps, so every authenticated
// list hit a "no such column" error and returned 500. This adds the autodate
// fields idempotently so already-migrated databases are repaired on boot.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("personas")
		if err != nil {
			return err
		}

		if collection.Fields.GetByName("created") == nil {
			if err := addLegacyField(app, collection, `{
				"id": "perscreated01",
				"name": "created",
				"type": "autodate",
				"system": false,
				"presentable": false,
				"hidden": false,
				"onCreate": true,
				"onUpdate": false
			}`); err != nil {
				return err
			}
		}

		if collection.Fields.GetByName("updated") == nil {
			if err := addLegacyField(app, collection, `{
				"id": "persupdated01",
				"name": "updated",
				"type": "autodate",
				"system": false,
				"presentable": false,
				"hidden": false,
				"onCreate": true,
				"onUpdate": true
			}`); err != nil {
				return err
			}
		}

		return app.Save(collection)
	}, func(app core.App) error {
		return nil
	})
}
