package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		// update
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "wbuzpppe",
			"name": "data",
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

		// update
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "nciypmmv",
			"name": "parent_message",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "v893vvhgp688kie",
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
		collection, err := app.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		// update
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "wbuzpppe",
			"name": "data",
			"type": "text",
			"required": true,
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

		// update
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "nciypmmv",
			"name": "parent_message",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "v893vvhgp688kie",
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
