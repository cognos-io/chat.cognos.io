package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// PII redaction collections (docs/business_processes/pii-redaction.md).
//
// Two collections, both locked down (all rules null) so the PocketBase
// collection API returns 403 and every access flows through the /api/v1
// redaction handlers, which authorise by active conversation participation —
// the same model as conversations, messages and public shares.
//
//   - conversation_redaction_keys: the per-conversation redaction keypair,
//     INDEPENDENT of the conversation key (a redacted-only public reader holds
//     the conversation key and must NOT be able to derive this one). public_key
//     is the same per generation (safe to expose so clients can seal new
//     entries); wrapped_secret_key is the redaction secret wrapped per user,
//     mirroring conversation_secret_keys.
//   - redaction_entries: token → encrypted original mapping. The server holds
//     only the token (plaintext, so clients can look up by token) plus the
//     sealed payload in `data`; the original sensitive value lives only inside
//     that ciphertext.
func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "crdk0redact001a",
				"name": "conversation_redaction_keys",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "crdkconv000001",
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
						"id": "crdkuser000001",
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
						"id": "crdkkeyver0001",
						"name": "key_version",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": null,
							"noDecimal": true
						}
					},
					{
						"system": false,
						"id": "crdkpubkey0001",
						"name": "public_key",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": 1024,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					},
					{
						"system": false,
						"id": "crdkwrapsec001",
						"name": "wrapped_secret_key",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": 1024,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_conversation_redaction_keys_conv_user_ver` + "`" + ` ON ` + "`" + `conversation_redaction_keys` + "`" + ` (` + "`" + `conversation` + "`" + `, ` + "`" + `user` + "`" + `, ` + "`" + `key_version` + "`" + `)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "rdne0entries01a",
				"name": "redaction_entries",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "rdneconv000001",
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
						"id": "rdnetoken00001",
						"name": "token",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": 64,
							"pattern": "^\\[\\[PII_[A-Z]+_[A-Z0-9]+\\]\\]$"
						}
					},
					{
						"system": false,
						"id": "rdnekeyver0001",
						"name": "key_version",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": null,
							"noDecimal": true
						}
					},
					{
						"system": false,
						"id": "rdnedata000001",
						"name": "data",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": 16384,
							"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
						}
					},
					{
						"system": false,
						"id": "rdnesrckind001",
						"name": "source_kind",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 1,
							"max": 32,
							"pattern": "^(message|document|document_chunk)$"
						}
					},
					{
						"system": false,
						"id": "rdnesrcid00001",
						"name": "source_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"min": 0,
							"max": 255,
							"pattern": ""
						}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_redaction_entries_conversation_token` + "`" + ` ON ` + "`" + `redaction_entries` + "`" + ` (` + "`" + `conversation` + "`" + `, ` + "`" + `token` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_redaction_entries_conversation_key_version` + "`" + ` ON ` + "`" + `redaction_entries` + "`" + ` (` + "`" + `conversation` + "`" + `, ` + "`" + `key_version` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_redaction_entries_conversation_source` + "`" + ` ON ` + "`" + `redaction_entries` + "`" + ` (` + "`" + `conversation` + "`" + `, ` + "`" + `source_kind` + "`" + `, ` + "`" + `source_id` + "`" + `)"
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
		for _, name := range []string{"redaction_entries", "conversation_redaction_keys"} {
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
