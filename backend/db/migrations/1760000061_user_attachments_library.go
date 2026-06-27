package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// User-scoped attachment library (spec docs/specs/attachments.md). Replaces the
// conversation-scoped conversation_attachments collection: a file now belongs to
// the USER (its per-file key + manifest are sealed to the user's personal key, so
// it is reusable across any of their chats), and a conversation only *references*
// a file through a message. Pre-release, no data to preserve, so the forward
// migration drops conversation_attachments and creates the new collections.
//
//   - user_attachments: owner-scoped ciphertext blobs + sealed manifest. Every
//     rule locked; access flows through the owner-gated /api/v1/attachments
//     handlers. Storage is summed per owner to enforce the 1 GiB cap.
//   - attachment_usages: plaintext join recording which (conversation, message)
//     reference a library file. Powers "used in chats" and lets a removed file
//     leave a tombstone in the chats that used it. The relation to the file is
//     intentionally NON-cascade: deleting a library file must NOT delete the
//     messages that referenced it. Usage rows DO cascade with their conversation
//     and message (and the user).
func init() {
	m.Register(func(app core.App) error {
		// Drop the old conversation-scoped collection first (no production data).
		if collection, err := app.FindCollectionByNameOrId("conversation_attachments"); err == nil {
			if err := app.Delete(collection); err != nil {
				return err
			}
		}

		jsonData := `[
			{
				"id": "userattach0001a",
				"name": "user_attachments",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "uattownr000001", "name": "owner", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "uattfile000001", "name": "files", "type": "file",
						"required": false, "presentable": false, "unique": false,
						"options": { "mimeTypes": [], "thumbs": null, "maxSelect": 16, "maxSize": 11534336, "protected": true }
					},
					{
						"system": false, "id": "uattsize000001", "name": "size_bytes", "type": "number",
						"required": false, "presentable": false, "unique": false,
						"options": { "min": 0, "max": null, "noDecimal": true }
					},
					{
						"system": false, "id": "uattdata000001", "name": "data", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 262144, "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" }
					},
					{
						"system": false, "id": "uattcrt0000001", "name": "created", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": false
					},
					{
						"system": false, "id": "uattupd0000001", "name": "updated", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": true
					}
				],
				"indexes": [
					"CREATE INDEX ` + "`" + `idx_user_attachments_owner` + "`" + ` ON ` + "`" + `user_attachments` + "`" + ` (` + "`" + `owner` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_user_attachments_owner_created` + "`" + ` ON ` + "`" + `user_attachments` + "`" + ` (` + "`" + `owner` + "`" + `, ` + "`" + `created` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			},
			{
				"id": "attachusage001a",
				"name": "attachment_usages",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "ausgatt0000001", "name": "attachment", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "userattach0001a", "cascadeDelete": false, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "ausgconv000001", "name": "conversation", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "23wjzzeeb4qilr9", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "ausgmsg0000001", "name": "message", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "v893vvhgp688kie", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "ausguser000001", "name": "user", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "ausgcrt0000001", "name": "created", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": false
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_attachment_usages_attach_msg` + "`" + ` ON ` + "`" + `attachment_usages` + "`" + ` (` + "`" + `attachment` + "`" + `, ` + "`" + `message` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_attachment_usages_attachment` + "`" + ` ON ` + "`" + `attachment_usages` + "`" + ` (` + "`" + `attachment` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_attachment_usages_conversation` + "`" + ` ON ` + "`" + `attachment_usages` + "`" + ` (` + "`" + `conversation` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_attachment_usages_message` + "`" + ` ON ` + "`" + `attachment_usages` + "`" + ` (` + "`" + `message` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			}
		]`

		return importLegacyCollections(app, jsonData, false)
	}, func(app core.App) error {
		// Reverse: drop the library collections (usages first — it relates to
		// user_attachments) and restore the conversation-scoped collection.
		for _, name := range []string{"attachment_usages", "user_attachments"} {
			if collection, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(collection); err != nil {
					return err
				}
			}
		}

		legacy := `[
			{
				"id": "convattach00001",
				"name": "conversation_attachments",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "convattconv001", "name": "conversation", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "23wjzzeeb4qilr9", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "convattownr001", "name": "owner", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "convattmsg0001", "name": "message", "type": "relation",
						"required": false, "presentable": false, "unique": false,
						"options": { "collectionId": "v893vvhgp688kie", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "convattfile001", "name": "files", "type": "file",
						"required": false, "presentable": false, "unique": false,
						"options": { "mimeTypes": [], "thumbs": null, "maxSelect": 16, "maxSize": 11534336, "protected": true }
					},
					{
						"system": false, "id": "convattsize001", "name": "size_bytes", "type": "number",
						"required": false, "presentable": false, "unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					},
					{
						"system": false, "id": "convattdata001", "name": "data", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 262144, "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" }
					},
					{
						"system": false, "id": "convattcrt001", "name": "created", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": false
					},
					{
						"system": false, "id": "convattupd001", "name": "updated", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": true
					}
				],
				"indexes": [
					"CREATE INDEX ` + "`" + `idx_conversation_attachments_conversation` + "`" + ` ON ` + "`" + `conversation_attachments` + "`" + ` (` + "`" + `conversation` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_conversation_attachments_owner` + "`" + ` ON ` + "`" + `conversation_attachments` + "`" + ` (` + "`" + `owner` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_conversation_attachments_message` + "`" + ` ON ` + "`" + `conversation_attachments` + "`" + ` (` + "`" + `message` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			}
		]`

		return importLegacyCollections(app, legacy, false)
	})
}
