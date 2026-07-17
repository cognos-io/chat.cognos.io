package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Organisations are the B2B billing + membership + policy boundary (see the
// domain glossary in CONTEXT.md). Unlike chat data, an Organisation is not
// content: its name is plaintext operational metadata, the same stance as
// ai_models or billing rows, so admin dashboards and invoices can render it
// server-side. It must never be logged alongside user content.
//
//   - organisations holds the name, the owning Account (`owner`) and
//     `dissolved_at` (stamped when the org is dissolved — the dissolution
//     flow itself ships in a later slice; empty means the org is live).
//   - org_memberships is the access-control list — deliberately a sibling of
//     `participants` / `project_participants` rather than a generalisation,
//     so each security-critical access filter stays explicit and
//     independently testable. An empty `removed_at` is the active-membership
//     filter — PocketBase stores empty dates as the empty string, NOT SQL
//     NULL, so raw SQL must compare removed_at against the empty string,
//     never IS NULL. Soft revoke keeps the row as audit data, and the unique
//     (organisation, user) index forces revoke+re-add flows to reactivate
//     the existing row instead of accumulating duplicates.
//
// As with the chat and project collections every rule is null: the
// /api/collections/* surface is locked (403) for everyone and all access
// flows through the /api/v1/orgs handlers, which authorise in Go via the
// organisations repo.
func init() {
	m.Register(func(app core.App) error {
		organisations := `{
			"id": "organisations01",
			"name": "organisations",
			"type": "base",
			"system": false,
			"fields": [
				{
					"system": false,
					"id": "orgname0000001",
					"name": "name",
					"type": "text",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"min": 1,
						"max": 120,
						"pattern": ""
					}
				},
				{
					"system": false,
					"id": "orgowner000001",
					"name": "owner",
					"type": "relation",
					"required": true,
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
					"id": "orgdissolved01",
					"name": "dissolved_at",
					"type": "date",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {"min": "", "max": ""}
				},
				{
					"system": false,
					"id": "orgcreated0001",
					"name": "created",
					"type": "autodate",
					"presentable": false,
					"hidden": false,
					"onCreate": true,
					"onUpdate": false
				},
				{
					"system": false,
					"id": "orgupdated0001",
					"name": "updated",
					"type": "autodate",
					"presentable": false,
					"hidden": false,
					"onCreate": true,
					"onUpdate": true
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

		if err := importLegacyCollections(app, organisations, false); err != nil {
			return err
		}

		// org_memberships relates to organisations, so it is imported in a
		// second pass once the organisations collection id resolves.
		memberships := `[
			{
				"id": "orgmemberships1",
				"name": "org_memberships",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "orgmorg0000001",
						"name": "organisation",
						"type": "relation",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "organisations01",
							"cascadeDelete": true,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"system": false,
						"id": "orgmuser000001",
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
						"id": "orgmrole000001",
						"name": "role",
						"type": "select",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"maxSelect": 1,
							"values": ["owner", "admin", "member"]
						}
					},
					{
						"system": false,
						"id": "orgmaddedat001",
						"name": "added_at",
						"type": "date",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"system": false,
						"id": "orgmremoved001",
						"name": "removed_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_org_memberships_organisation_user` + "`" + ` ON ` + "`" + `org_memberships` + "`" + ` (` + "`" + `organisation` + "`" + `, ` + "`" + `user` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_org_memberships_user` + "`" + ` ON ` + "`" + `org_memberships` + "`" + ` (` + "`" + `user` + "`" + `)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			}
		]`

		return importLegacyCollections(app, memberships, false)
	}, func(app core.App) error {
		// Drop the dependent before the parent so the relation FK unwinds
		// cleanly.
		for _, name := range []string{
			"org_memberships",
			"organisations",
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
