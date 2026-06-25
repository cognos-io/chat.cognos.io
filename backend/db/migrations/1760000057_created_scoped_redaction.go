package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// User- and project-scoped redaction so a PII placeholder pinned to user/project
// memory hydrates wherever that scope is shown — not just the conversation it was
// minted in (closes the project-redaction-keys gap). Mirrors the conversation
// redaction collections (1760000042): server holds only tokens + sealed
// originals, never plaintext.
//
//   - user_redaction_entries: token → original sealed to the USER's own public
//     key. The user is the sole party, so no separate keypair is needed.
//   - project_redaction_keys: a per-project redaction keypair INDEPENDENT of the
//     project content key (so a future redacted-only project reader can't derive
//     it), wrapped per active member — exactly like conversation_redaction_keys.
//   - project_redaction_entries: token → original sealed to the project redaction
//     public key.
//
// All rules null: access flows through the /api/v1 handlers (ownership for user,
// active membership for project).
func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "urde0redact001a",
				"name": "user_redaction_entries",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "urdeuser000001", "name": "user", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "urdetoken00001", "name": "token", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 64, "pattern": "^\\[\\[PII_[A-Z]+_[A-Z0-9]+\\]\\]$" }
					},
					{
						"system": false, "id": "urdedata000001", "name": "data", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 16384, "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" }
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_user_redaction_entries_user_token` + "`" + ` ON ` + "`" + `user_redaction_entries` + "`" + ` (` + "`" + `user` + "`" + `, ` + "`" + `token` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			},
			{
				"id": "prkey0redact01a",
				"name": "project_redaction_keys",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "prkeyproj00001", "name": "project", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "projects0000001", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "prkeyuser00001", "name": "user", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "prkeyver000001", "name": "key_version", "type": "number",
						"required": false, "presentable": false, "unique": false,
						"options": { "min": 1, "max": null, "noDecimal": true }
					},
					{
						"system": false, "id": "prkeypub000001", "name": "public_key", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 1024, "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" }
					},
					{
						"system": false, "id": "prkeywrap00001", "name": "wrapped_secret_key", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 1024, "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" }
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_project_redaction_keys_proj_user_ver` + "`" + ` ON ` + "`" + `project_redaction_keys` + "`" + ` (` + "`" + `project` + "`" + `, ` + "`" + `user` + "`" + `, ` + "`" + `key_version` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			},
			{
				"id": "prde0redact001a",
				"name": "project_redaction_entries",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "prdeproj000001", "name": "project", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "projects0000001", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "prdetoken00001", "name": "token", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 64, "pattern": "^\\[\\[PII_[A-Z]+_[A-Z0-9]+\\]\\]$" }
					},
					{
						"system": false, "id": "prdever0000001", "name": "key_version", "type": "number",
						"required": false, "presentable": false, "unique": false,
						"options": { "min": 1, "max": null, "noDecimal": true }
					},
					{
						"system": false, "id": "prdedata000001", "name": "data", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 16384, "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" }
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_project_redaction_entries_proj_token` + "`" + ` ON ` + "`" + `project_redaction_entries` + "`" + ` (` + "`" + `project` + "`" + `, ` + "`" + `token` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			}
		]`

		return importLegacyCollections(app, jsonData, false)
	}, func(app core.App) error {
		for _, name := range []string{
			"project_redaction_entries",
			"project_redaction_keys",
			"user_redaction_entries",
		} {
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
