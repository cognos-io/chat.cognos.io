package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Phase 3 of projects (see docs/specs/projects.md): conversations can belong to
// a project, and a project conversation's secret key is wrapped by the project
// content key instead of per-participant.
//
//   - conversations gains an optional `project` relation. When set, access is
//     gated by project membership (not the conversation participants table);
//     deleting the project cascade-deletes its conversations (and their
//     messages / keys cascade in turn).
//   - project_conversation_keys stores the conversation secret key wrapped by
//     the project content key, stamped with both the conversation and project
//     key versions so a future rotation of either can be reconciled. The
//     server only ever holds ciphertext.
//
// Rules are null (locked) like every other chat/project collection — access
// flows through the /api/v1 handlers, which authorise in Go.
func init() {
	m.Register(func(app core.App) error {
		conversations, err := app.FindCollectionByNameOrId("conversations")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, conversations, `{
			"system": false,
			"id": "relprojconv01",
			"name": "project",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "projects0000001",
				"cascadeDelete": true,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`); err != nil {
			return err
		}
		if err := app.Save(conversations); err != nil {
			return err
		}

		projectConversationKeys := `{
			"id": "projconvkeys001",
			"name": "project_conversation_keys",
			"type": "base",
			"system": false,
			"fields": [
				{
					"system": false,
					"id": "pckproject0001",
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
					"id": "pckconv000001",
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
					"id": "pckconvkeyv01",
					"name": "conversation_key_version",
					"type": "number",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {"min": 1, "max": null, "noDecimal": true}
				},
				{
					"system": false,
					"id": "pckprojkeyv01",
					"name": "project_key_version",
					"type": "number",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {"min": 1, "max": null, "noDecimal": true}
				},
				{
					"system": false,
					"id": "pckwrapped0001",
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
				}
			],
			"indexes": [
				"CREATE UNIQUE INDEX ` + "`" + `idx_project_conversation_keys_conv_version` + "`" + ` ON ` + "`" + `project_conversation_keys` + "`" + ` (` + "`" + `conversation` + "`" + `, ` + "`" + `project_key_version` + "`" + `)"
			],
			"listRule": null,
			"viewRule": null,
			"createRule": null,
			"updateRule": null,
			"deleteRule": null,
			"options": {}
		}`

		return importLegacyCollections(app, projectConversationKeys, false)
	}, func(app core.App) error {
		if collection, err := app.FindCollectionByNameOrId("project_conversation_keys"); err == nil {
			if err := app.Delete(collection); err != nil {
				return err
			}
		}
		conversations, err := app.FindCollectionByNameOrId("conversations")
		if err != nil {
			return nil
		}
		conversations.Fields.RemoveById("relprojconv01")
		return app.Save(conversations)
	})
}
