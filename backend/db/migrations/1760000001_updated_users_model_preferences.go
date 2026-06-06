package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "users_privacy_tier",
			"name": "privacy_tier",
			"type": "select",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"maxSelect": 1,
				"values": ["ch_only", "eu", "global"]
			}
		}`); err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "users_preferred_model_id",
			"name": "preferred_model_id",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		collection.Fields.RemoveById("users_privacy_tier")
		collection.Fields.RemoveById("users_preferred_model_id")

		return app.Save(collection)
	})
}
