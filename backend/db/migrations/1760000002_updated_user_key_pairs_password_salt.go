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
			"id": "user_key_pairs_password_salt",
			"name": "password_salt",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
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

		collection.Fields.RemoveById("user_key_pairs_password_salt")
		return app.Save(collection)
	})
}
