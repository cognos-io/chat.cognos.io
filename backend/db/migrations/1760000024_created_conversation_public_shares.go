package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// conversation_public_shares backs the public-link sharing feature. A row
// exists only while a conversation is publicly shared; revoking (which always
// rotates the conversation key) deletes it, so the public URL stops resolving.
//
// The server only ever holds ciphertext + wrapped keys, exactly like the rest
// of the chat data:
//   - public_key: the public half of the throwaway "public-share" keypair S.
//     Its SECRET half lives in the URL fragment and never reaches the server.
//   - wrapped_conversation_secret_key: the conversation secret sealed to S's
//     public key, so an anonymous reader holding the fragment can recover it.
//   - share_secret: S's secret key sealed to the conversation public key, so
//     any participant (they all hold the conversation keypair) can recover the
//     fragment and reconstruct the identical link.
//
// All collection rules are null: the collection API is locked (403) like the
// rest of the chat collections, and access flows exclusively through the
// /api/v1 handlers which authorise in Go.
func init() {
	m.Register(func(app core.App) error {
		jsonData := `{
			"id": "cps9share01sn00",
			"name": "conversation_public_shares",
			"type": "base",
			"system": false,
			"fields": [
				{
					"system": false,
					"id": "cpsconv0000001",
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
					"id": "cpstoken000001",
					"name": "token",
					"type": "text",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"min": 10,
						"max": 64,
						"pattern": "^[A-Za-z0-9]+$"
					}
				},
				{
					"system": false,
					"id": "cpspubkey00001",
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
					"id": "cpswrapsec0001",
					"name": "wrapped_conversation_secret_key",
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
					"id": "cpssharesec001",
					"name": "share_secret",
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
					"id": "cpskeyver00001",
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
				}
			],
			"indexes": [
				"CREATE UNIQUE INDEX ` + "`" + `idx_conversation_public_shares_conversation` + "`" + ` ON ` + "`" + `conversation_public_shares` + "`" + ` (` + "`" + `conversation` + "`" + `)",
				"CREATE UNIQUE INDEX ` + "`" + `idx_conversation_public_shares_token` + "`" + ` ON ` + "`" + `conversation_public_shares` + "`" + ` (` + "`" + `token` + "`" + `)"
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
		collection, err := app.FindCollectionByNameOrId("conversation_public_shares")
		if err != nil {
			return err
		}

		return app.Delete(collection)
	})
}
