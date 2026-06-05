package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("52et2jthsxn7mjr")
		if err != nil {
			return err
		}

		return app.Delete(collection)
	}, func(app core.App) error {
		jsonData := `{
			"id": "52et2jthsxn7mjr",
			"created": "2024-02-25 10:52:06.278Z",
			"updated": "2024-03-16 14:44:28.376Z",
			"name": "participants",
			"type": "base",
			"system": false,
			"fields": [
				{
					"system": false,
					"id": "ba8hv4fd",
					"name": "conversation",
					"type": "relation",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {
						"collectionId": "23wjzzeeb4qilr9",
						"cascadeDelete": false,
						"minSelect": null,
						"maxSelect": 1,
						"displayFields": null
					}
				},
				{
					"system": false,
					"id": "3rnus5de",
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
					"id": "fnjvvx46",
					"name": "role",
					"type": "select",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {
						"maxSelect": 1,
						"values": [
							"Viewer",
							"Editor",
							"Admin"
						]
					}
				}
			],
			"indexes": [
				"CREATE UNIQUE INDEX ` + "`" + `idx_eVob3Ru` + "`" + ` ON ` + "`" + `participants` + "`" + ` (\n  ` + "`" + `conversation` + "`" + `,\n  ` + "`" + `user` + "`" + `\n)"
			],
			"listRule": null,
			"viewRule": null,
			"createRule": "@request.auth.id != \"\"",
			"updateRule": null,
			"deleteRule": null,
			"options": {}
		}`

		return importLegacyCollections(app, jsonData, false)
	})
}
