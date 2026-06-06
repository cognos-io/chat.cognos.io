package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("user_key_pairs")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "user_key_pairs_unlock_scheme",
			"name": "unlock_scheme",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": "^(password_only_v1|password_account_key_v1)?$"
			}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("user_key_pairs")
		if err != nil {
			return err
		}

		collection.Fields.RemoveById("user_key_pairs_unlock_scheme")
		return app.Save(collection)
	})
}
