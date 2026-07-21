package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Projects are shared encrypted workspaces (see docs/business_processes/project-management.md). They
// mirror the conversation crypto + participant model so sharing can light up
// in a later phase without a rewrite:
//
//   - projects holds plaintext operational metadata (creator, key_version,
//     archived_at) plus an encrypted `data` blob (name/description/settings).
//   - project_participants is the access-control list — a clone of the
//     `participants` collection scoped to projects. `removed_at IS NULL` is the
//     active-participant filter, enforced by the projectparticipants store.
//   - project_key_wrappings stores the random symmetric project content key
//     sealed to each active participant's public key. The server only ever
//     holds ciphertext; it never sees the plaintext project content key.
//
// As with the chat collections (migration 20) every rule is null: the
// /api/collections/* surface is locked (403) for everyone and all access flows
// through the /api/v1 handlers, which authorise in Go via the
// projectparticipants repo.
func init() {
	m.Register(func(app core.App) error {
		projects := `{
			"id": "projects0000001",
			"name": "projects",
			"type": "base",
			"system": false,
			"fields": [
				{
					"system": false,
					"id": "projcreator001",
					"name": "creator",
					"type": "relation",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {
						"collectionId": "_pb_users_auth_",
						"cascadeDelete": false,
						"minSelect": null,
						"maxSelect": 1,
						"displayFields": null
					}
				},
				{
					"system": false,
					"id": "projdata000001",
					"name": "data",
					"type": "text",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"min": 1,
						"max": 100000,
						"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
					}
				},
				{
					"system": false,
					"id": "projkeyver0001",
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
					"id": "projarchived01",
					"name": "archived_at",
					"type": "date",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {"min": "", "max": ""}
				}
			],
			"indexes": [],
			"listRule": null,
			"viewRule": null,
			"createRule": null,
			"updateRule": null,
			"deleteRule": null,
			"options": {}
		}`

		if err := importLegacyCollections(app, projects, false); err != nil {
			return err
		}

		// project_participants and project_key_wrappings both relate to
		// projects, so they are imported in a second pass once the projects
		// collection id resolves.
		dependents := `[
			{
				"id": "projpartcptn001",
				"name": "project_participants",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "ppproject00001",
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
						"id": "ppuser0000001",
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
						"id": "pprole0000001",
						"name": "role",
						"type": "select",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"maxSelect": 1,
							"values": ["Viewer", "Editor", "Admin"]
						}
					},
					{
						"system": false,
						"id": "ppaddedat0001",
						"name": "added_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"system": false,
						"id": "ppremovedat01",
						"name": "removed_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_project_participants_project_user` + "`" + ` ON ` + "`" + `project_participants` + "`" + ` (` + "`" + `project` + "`" + `, ` + "`" + `user` + "`" + `)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "projkeywrap0001",
				"name": "project_key_wrappings",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "pkwproject0001",
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
						"id": "pkwuser000001",
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
						"id": "pkwkeyver0001",
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
						"id": "pkwwrapped001",
						"name": "wrapped_project_key",
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
					"CREATE UNIQUE INDEX ` + "`" + `idx_project_key_wrappings_project_user_version` + "`" + ` ON ` + "`" + `project_key_wrappings` + "`" + ` (` + "`" + `project` + "`" + `, ` + "`" + `user` + "`" + `, ` + "`" + `key_version` + "`" + `)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			}
		]`

		return importLegacyCollections(app, dependents, false)
	}, func(app core.App) error {
		// Drop dependents before the parent so the relation FKs unwind cleanly.
		for _, name := range []string{
			"project_key_wrappings",
			"project_participants",
			"projects",
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
