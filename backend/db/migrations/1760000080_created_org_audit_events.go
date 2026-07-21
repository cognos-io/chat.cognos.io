package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Content-free organisation audit log. See
// docs/business_processes/organisation-lifecycle.md.
//
//   - org_audit_events records administrative events only: membership,
//     invites, policies, billing, project sharing and key rotation. One row
//     per mutation, written best-effort by the /api/v1 handlers.
//   - action is a dot-namespaced verb (e.g. org.member.offboarded,
//     org.invite.created); target is an OPAQUE record id (invite row id,
//     user id, project id) — NEVER message content, conversation titles or
//     invite emails. A pin test regexes stored targets to enforce this.
//   - rows are immutable; there is no updated autodate and no update path.
//
// As with all organisation collections every rule is null: the
// /api/collections/* surface is locked (403) for everyone and all access
// flows through the /api/v1 handlers (owner/admin only, newest first).
func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "orgauditev0001",
				"name": "org_audit_events",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "relauditorg01",
						"name": "organisation",
						"type": "relation",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "organisations01",
							"cascadeDelete": false,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"system": false,
						"id": "relauditactor1",
						"name": "actor",
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
						"id": "txtauditaction",
						"name": "action",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"system": false,
						"id": "txtaudittarget",
						"name": "target",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"system": false,
						"id": "dtauditcrea01",
						"name": "created",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": false
					}
				],
				"indexes": [
					"CREATE INDEX ` + "`" + `idx_org_audit_events_org_created` + "`" + ` ON ` + "`" + `org_audit_events` + "`" + ` (` + "`" + `organisation` + "`" + `, ` + "`" + `created` + "`" + `)"
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
		collection, err := app.FindCollectionByNameOrId("org_audit_events")
		if err != nil {
			return nil
		}
		return app.Delete(collection)
	})
}
