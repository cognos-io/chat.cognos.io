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

		// add
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "xuxxmxiy",
			"name": "expires",
			"type": "date",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": "2024-06-01 12:00:00.000Z",
				"max": ""
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

		// remove
		collection.Fields.RemoveById("xuxxmxiy")

		return app.Save(collection)
	})
}
