package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("kx3ewd64kz2os37")
		if err != nil {
			return err
		}

		// update
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "ohmtgv8t",
			"name": "user",
			"type": "relation",
			"required": true,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "_pb_users_auth_",
				"cascadeDelete": true,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("kx3ewd64kz2os37")
		if err != nil {
			return err
		}

		// update
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "ohmtgv8t",
			"name": "user",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "_pb_users_auth_",
				"cascadeDelete": false,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	})
}
