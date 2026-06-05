package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		jsonData := `{
			"id": "ck0wav09a3ouets",
			"created": "2024-06-21 09:57:53.969Z",
			"updated": "2024-06-21 09:57:53.969Z",
			"name": "user_preferences",
			"type": "base",
			"system": false,
			"fields": [
				{
					"system": false,
					"id": "a1zycynp",
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
					"id": "xqolutf8",
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
			"listRule": "@request.auth.id != \"\" && \n@request.auth.id = user",
			"viewRule": "@request.auth.id != \"\" && \n@request.auth.id = user",
			"createRule": "@request.auth.id != \"\" && \n@request.auth.id = @request.body.user &&\n// Additional validation\n@request.body.id:isset = false &&\n@request.body.created:isset = false &&\n@request.body.updated:isset = false &&\n@request.body.data:isset = true",
			"updateRule": "@request.auth.id != \"\" && \n@request.auth.id = user",
			"deleteRule": "@request.auth.id != \"\" && \n@request.auth.id = user",
			"options": {}
		}`

		return importLegacyCollections(app, jsonData, false)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ck0wav09a3ouets")
		if err != nil {
			return err
		}

		return app.Delete(collection)
	})
}
