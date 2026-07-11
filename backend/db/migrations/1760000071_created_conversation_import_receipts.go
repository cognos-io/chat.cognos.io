package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// conversation_import_receipts gives the ciphertext-only import endpoint a
// narrowly scoped idempotency record. Collection rules stay locked: callers
// can neither enumerate tokens nor alter receipts through PocketBase CRUD.
func init() {
	m.Register(func(app core.App) error {
		jsonData := `{
			"id": "convimp0receipt",
			"name": "conversation_import_receipts",
			"type": "base",
			"system": false,
			"fields": [
				{"id":"convimpuser001","name":"user","type":"relation","required":true,"options":{"collectionId":"_pb_users_auth_","cascadeDelete":true,"maxSelect":1}},
				{"id":"convimptoken01","name":"import_id","type":"text","required":true,"options":{"min":16,"max":64,"pattern":"^[A-Za-z0-9_-]+$"}},
				{"id":"convimpdigest1","name":"request_digest","type":"text","required":true,"options":{"min":64,"max":64,"pattern":"^[a-f0-9]{64}$"}},
				{"id":"convimpconv001","name":"conversation","type":"relation","required":true,"options":{"collectionId":"23wjzzeeb4qilr9","cascadeDelete":true,"maxSelect":1}},
				{"id":"convimpcount01","name":"message_count","type":"number","required":true,"options":{"min":0,"max":10000,"onlyInt":true}},
				{"id":"convimpcreated","name":"created","type":"autodate","onCreate":true,"onUpdate":false}
			],
			"indexes": ["CREATE UNIQUE INDEX ` + "`" + `idx_conversation_import_receipt_user_token` + "`" + ` ON ` + "`" + `conversation_import_receipts` + "`" + ` (` + "`" + `user` + "`" + `, ` + "`" + `import_id` + "`" + `)"],
			"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
			"options": {}
		}`
		return importLegacyCollections(app, jsonData, false)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversation_import_receipts")
		if err != nil {
			return nil
		}
		return app.Delete(collection)
	})
}
