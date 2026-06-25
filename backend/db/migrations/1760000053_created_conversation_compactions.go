package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Conversation compaction collection (spec docs/specs/client-side-compaction.md §6).
//
// Stores encrypted summaries of older prefixes of a conversation's active branch
// so long chats keep fitting model context windows. Like messages and redaction
// entries, it is locked down (all rules null) so the PocketBase collection API
// returns 403 and every access flows through the /api/v1 compaction handlers,
// which authorise by active conversation participation.
//
// Only routing/access fields are plaintext:
//   - conversation: relation used to authorise and list compactions.
//   - data: base64(SealAnonymous(conversation_public_key, payload)). Everything
//     else (anchor, covered message IDs, summary, citations, token estimates,
//     model, fold lineage) lives INSIDE that ciphertext — never in a column.
func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "cmpct0compac01a",
				"name": "conversation_compactions",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "cmpctconv00001",
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
						"id": "cmpctdata00001",
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
						"id": "cmpctcreated01",
						"name": "created",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": false
					},
					{
						"system": false,
						"id": "cmpctupdated01",
						"name": "updated",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": true
					}
				],
				"indexes": [
					"CREATE INDEX ` + "`" + `idx_conversation_compactions_conversation` + "`" + ` ON ` + "`" + `conversation_compactions` + "`" + ` (` + "`" + `conversation` + "`" + `)"
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
		collection, err := app.FindCollectionByNameOrId("conversation_compactions")
		if err != nil {
			return nil
		}
		return app.Delete(collection)
	})
}
