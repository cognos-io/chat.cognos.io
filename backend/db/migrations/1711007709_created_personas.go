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
			"name": "personas",
			"type": "base",
			"system": false,
			"fields": [
				{
					"system": false,
					"id": "persuser001",
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
				},
				{
					"system": false,
					"id": "persdata001",
					"name": "data",
					"type": "text",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"min": null,
						"max": 1048576,
						"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
					}
				}
			],
			"indexes": [],
			"listRule": "@request.auth.id != \"\" && @request.auth.id = user",
			"viewRule": "@request.auth.id != \"\" && @request.auth.id = user",
			"createRule": "@request.auth.id != \"\" && @request.auth.id = @request.body.user && @request.body.id:isset = false && @request.body.created:isset = false && @request.body.updated:isset = false && @request.body.data:isset = true",
			"updateRule": "@request.auth.id != \"\" && @request.auth.id = user",
			"deleteRule": "@request.auth.id != \"\" && @request.auth.id = user",
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
