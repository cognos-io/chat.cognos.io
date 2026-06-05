package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		jsonData := `{
			"id": "bg088f2xo7gdkm1",
			"created": "2024-03-23 08:27:35.358Z",
			"updated": "2024-03-23 08:27:35.358Z",
			"name": "idempotency",
			"type": "base",
			"system": false,
			"fields": [
				{
					"system": false,
					"id": "dssywrdw",
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
				},
				{
					"system": false,
					"id": "3szlghf8",
					"name": "idempotency_key",
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
					"id": "eiqq0rvx",
					"name": "status_code",
					"type": "number",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {
						"min": null,
						"max": null,
						"noDecimal": false
					}
				},
				{
					"system": false,
					"id": "rca5w7hu",
					"name": "body",
					"type": "json",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {
						"maxSize": 2000000
					}
				}
			],
			"indexes": [
				"CREATE UNIQUE INDEX ` + "`" + `idx_msanFgE` + "`" + ` ON ` + "`" + `idempotency` + "`" + ` (\n  ` + "`" + `user` + "`" + `,\n  ` + "`" + `idempotency_key` + "`" + `\n)"
			],
			"listRule": null,
			"viewRule": null,
			"createRule": null,
			"updateRule": null,
			"deleteRule": null,
			"options": {}
		}`

		return importLegacyCollections(app, jsonData, false)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("bg088f2xo7gdkm1")
		if err != nil {
			return err
		}

		return app.Delete(collection)
	})
}
