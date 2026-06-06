package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		jsonData := `{
			"id": "vswk1ses001sn00",
			"name": "vault_session_wrap_keys",
			"type": "base",
			"system": false,
			"fields": [
				{
					"system": false,
					"id": "vswkuser01",
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
					"id": "vswkwrap01",
					"name": "wrap_key",
					"type": "text",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"min": 32,
						"max": 128,
						"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
					}
				}
			],
			"indexes": [
				"CREATE UNIQUE INDEX ` + "`" + `idx_vault_session_wrap_keys_user` + "`" + ` ON ` + "`" + `vault_session_wrap_keys` + "`" + ` (` + "`" + `user` + "`" + `)"
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
		collection, err := app.FindCollectionByNameOrId("vault_session_wrap_keys")
		if err != nil {
			return err
		}

		return app.Delete(collection)
	})
}
