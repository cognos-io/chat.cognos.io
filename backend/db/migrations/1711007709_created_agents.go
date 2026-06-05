package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		jsonData := `{
			"id": "l9i0pyg6kx2m0t5",
			"created": "2024-03-21 07:55:09.084Z",
			"updated": "2024-03-21 07:55:09.084Z",
			"name": "agents",
			"type": "base",
			"system": false,
			"fields": [
				{
					"system": false,
					"id": "izdzf11m",
					"name": "name",
					"type": "text",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"min": null,
						"max": null,
						"pattern": ""
					}
				},
				{
					"system": false,
					"id": "zy00qn7p",
					"name": "slug",
					"type": "text",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"min": null,
						"max": null,
						"pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
					}
				},
				{
					"system": false,
					"id": "rj2zqvz5",
					"name": "description",
					"type": "text",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"min": null,
						"max": null,
						"pattern": ""
					}
				}
			],
			"indexes": [],
			"listRule": null,
			"viewRule": null,
			"createRule": null,
			"updateRule": null,
			"deleteRule": null,
			"options": {}
		}`

		return importLegacyCollections(app, jsonData, false)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("l9i0pyg6kx2m0t5")
		if err != nil {
			return err
		}

		return app.Delete(collection)
	})
}
