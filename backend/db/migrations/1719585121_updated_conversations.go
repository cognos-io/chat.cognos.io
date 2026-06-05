package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		// add
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "4jng92aq",
			"name": "expiry_duration",
			"type": "select",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"maxSelect": 1,
				"values": [
					"24h",
					"7d",
					"90d",
					"6m"
				]
			}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		// remove
		collection.Fields.RemoveById("4jng92aq")

		return app.Save(collection)
	})
}
