package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// User bookmarks: a client-encrypted, ciphertext-only store of user-highlighted
// text spans from a message. It mirrors user_memory / conversation_compactions —
// all rules locked so every access flows through the /api/v1/bookmarks handlers,
// which authorise by ownership (user) and conversation access.
//
// The highlighted text is chat content, so it is sealed CLIENT-SIDE to the
// user's public key and stored only as opaque base64 in `data`. The `user`,
// `conversation` and `message` columns are plaintext linking ids (house style —
// matches conversation_compactions carrying a plaintext conversation relation).
func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "usrbmk0bookmk1a",
				"name": "user_bookmarks",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "usrbmkuser0001",
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
						"id": "usrbmkconv0001",
						"name": "conversation",
						"type": "relation",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "23wjzzeeb4qilr9",
							"cascadeDelete": true,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"system": false,
						"id": "usrbmkmsg00001",
						"name": "message",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": 255,
							"pattern": ""
						}
					},
					{
						"system": false,
						"id": "usrbmkdata0001",
						"name": "data",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": 8192,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					},
					{
						"system": false,
						"id": "usrbmkcreate01",
						"name": "created",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": false
					},
					{
						"system": false,
						"id": "usrbmkupdate01",
						"name": "updated",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": true
					}
				],
				"indexes": [
					"CREATE INDEX ` + "`" + `idx_user_bookmarks_user` + "`" + ` ON ` + "`" + `user_bookmarks` + "`" + ` (` + "`" + `user` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_user_bookmarks_user_conversation` + "`" + ` ON ` + "`" + `user_bookmarks` + "`" + ` (` + "`" + `user` + "`" + `, ` + "`" + `conversation` + "`" + `)"
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
		collection, err := app.FindCollectionByNameOrId("user_bookmarks")
		if err != nil {
			return nil
		}
		return app.Delete(collection)
	})
}
