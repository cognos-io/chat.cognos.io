package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Org invites collection (spec docs/checkpoints/2026-07-18-organisations-teams-v1.md §3).
//
//   - org_invites holds pending invitations to join an Organisation. The
//     token is returned ONCE to the inviting admin and stored only as a
//     SHA-256 hash; the accept endpoint receives the raw token, hashes it,
//     and looks up the invite.
//   - invited_email is optional so that token-only invites (share-link style)
//     remain possible in later slices.
//   - project_ids is a JSON array of project IDs the inviting admin intends
//     to grant access to; the server stores it opaquely and the client
//     handles key wrapping after acceptance.
//   - consumed_at / consumed_by track when an invite was accepted; together
//     with expires_at they allow the accept endpoint to reject stale or
//     already-used tokens with a neutral 404.
//
// As with all organisation collections every rule is null: the
// /api/collections/* surface is locked (403) for everyone and all access
// flows through the /api/v1 handlers.
//
// Partial-unique pending-per-(org,email) cannot be expressed as a schema
// index because consumed invites must remain in the table as audit data;
// the handler enforces the ≤1 pending rule in Go. A plain index on
// (organisation, invited_email) supports fast lookup.
func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "orginvites0001",
				"name": "org_invites",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false,
						"id": "relinviteorg1",
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
						"id": "txtinviteemail",
						"name": "invited_email",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"system": false,
						"id": "selinviterole",
						"name": "role",
						"type": "select",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"maxSelect": 1,
							"values": ["member", "admin"]
						}
					},
					{
						"system": false,
						"id": "txtinvitetoken",
						"name": "token_hash",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": true,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"system": false,
						"id": "jsoninviteproj",
						"name": "project_ids",
						"type": "json",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {}
					},
					{
						"system": false,
						"id": "dtinviteexpire",
						"name": "expires_at",
						"type": "date",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"system": false,
						"id": "dtinviteconsum",
						"name": "consumed_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"system": false,
						"id": "relinviteuser1",
						"name": "consumed_by",
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
						"id": "dtinvitecrea1",
						"name": "created",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": false
					},
					{
						"system": false,
						"id": "dtinviteupda1",
						"name": "updated",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": true
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_org_invites_token_hash` + "`" + ` ON ` + "`" + `org_invites` + "`" + ` (` + "`" + `token_hash` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_org_invites_organisation_email` + "`" + ` ON ` + "`" + `org_invites` + "`" + ` (` + "`" + `organisation` + "`" + `, ` + "`" + `invited_email` + "`" + `)"
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
		collection, err := app.FindCollectionByNameOrId("org_invites")
		if err != nil {
			return nil
		}
		return app.Delete(collection)
	})
}
