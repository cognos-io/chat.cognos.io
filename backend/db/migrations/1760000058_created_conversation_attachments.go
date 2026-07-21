package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// conversation_attachments stores client-side encrypted user-uploaded
// attachments (docs/business_processes/attachment-processing.md). It mirrors the ciphertext-only
// collections (user_memory, conversation_compactions): every rule is locked, so
// all access flows through the /api/v1 conversation attachment handlers, which
// authorise by conversation participant access.
//
// Fields:
//   - conversation/owner: plaintext routing + access control + storage accounting.
//   - message: set once the user message is persisted; empty for pre-send drafts.
//   - files: protected file[] holding only ciphertext blobs (original + derived
//     artifacts). Never publicly addressable; served via the custom download route.
//   - size_bytes: total ciphertext bytes across files, summed per owner to enforce
//     the 1 GiB per-user storage cap. Operational metadata only.
//   - data: base64 sealed manifest (filenames, MIME types, artifact keys, hashes)
//     encrypted to the conversation public key. The server never reads it.
func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "convattach00001",
				"name": "conversation_attachments",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "convattconv001",
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
						"id": "convattownr001",
						"name": "owner",
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
						"id": "convattmsg0001",
						"name": "message",
						"type": "relation",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "v893vvhgp688kie",
							"cascadeDelete": true,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"system": false,
						"id": "convattfile001",
						"name": "files",
						"type": "file",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"mimeTypes": [],
							"thumbs": null,
							"maxSelect": 16,
							"maxSize": 11534336,
							"protected": true
						}
					},
					{
						"system": false,
						"id": "convattsize001",
						"name": "size_bytes",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					},
					{
						"system": false,
						"id": "convattdata001",
						"name": "data",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": 262144,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					},
					{
						"system": false,
						"id": "convattcrt001",
						"name": "created",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": false
					},
					{
						"system": false,
						"id": "convattupd001",
						"name": "updated",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": true
					}
				],
				"indexes": [
					"CREATE INDEX ` + "`" + `idx_conversation_attachments_conversation` + "`" + ` ON ` + "`" + `conversation_attachments` + "`" + ` (` + "`" + `conversation` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_conversation_attachments_owner` + "`" + ` ON ` + "`" + `conversation_attachments` + "`" + ` (` + "`" + `owner` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_conversation_attachments_message` + "`" + ` ON ` + "`" + `conversation_attachments` + "`" + ` (` + "`" + `message` + "`" + `)"
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
		collection, err := app.FindCollectionByNameOrId("conversation_attachments")
		if err != nil {
			return nil
		}
		return app.Delete(collection)
	})
}
