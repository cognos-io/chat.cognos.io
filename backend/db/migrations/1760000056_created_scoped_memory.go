package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// User- and project-scoped memory collections (spec docs/specs/client-side-
// compaction.md §16.4). They mirror conversation_compactions: ciphertext-only,
// all rules locked so every access flows through the /api/v1 memory handlers,
// which authorise by ownership (user memory) or active project membership
// (project memory).
//
// Both store a client-encrypted `data` blob — user memory sealed to the user's
// public key, project memory sealed with the project content key — so the
// server never holds plaintext, exactly like manual conversation memory.
func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "usrmem0memory1a",
				"name": "user_memory",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "usrmemuser0001",
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
						"id": "usrmemdata0001",
						"name": "data",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": 131072,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					},
					{
						"system": false,
						"id": "usrmemcreate01",
						"name": "created",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": false
					},
					{
						"system": false,
						"id": "usrmemupdate01",
						"name": "updated",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": true
					}
				],
				"indexes": [
					"CREATE INDEX ` + "`" + `idx_user_memory_user` + "`" + ` ON ` + "`" + `user_memory` + "`" + ` (` + "`" + `user` + "`" + `)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "prjmem0memory1a",
				"name": "project_memory",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "prjmemproj0001",
						"name": "project",
						"type": "relation",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "projects0000001",
							"cascadeDelete": true,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"system": false,
						"id": "prjmemdata0001",
						"name": "data",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": 131072,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					},
					{
						"system": false,
						"id": "prjmemcreate01",
						"name": "created",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": false
					},
					{
						"system": false,
						"id": "prjmemupdate01",
						"name": "updated",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": true
					}
				],
				"indexes": [
					"CREATE INDEX ` + "`" + `idx_project_memory_project` + "`" + ` ON ` + "`" + `project_memory` + "`" + ` (` + "`" + `project` + "`" + `)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			}
		]`

		return importLegacyCollections(app, jsonData, false)
	}, func(app core.App) error {
		for _, name := range []string{"user_memory", "project_memory"} {
			collection, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				continue
			}
			if err := app.Delete(collection); err != nil {
				return err
			}
		}
		return nil
	})
}
