package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Enable Google OAuth sign-in (docs/business_processes/oauth-google-sign-in.md).
//
// Provider client id/secret are configured per environment in the PocketBase
// admin UI (never committed). This migration only flips the collection flags
// and MappedFields, and adds Cognos bookkeeping for password-less Accounts.
//
//   - OAuth2.Enabled = true, MappedFields.Name → display_name (no avatar map)
//   - has_cognos_password: hidden; true for password Accounts, false for
//     OAuth-created Accounts (PB always stores a random password hash for
//     OAuth users, so the hash alone cannot distinguish them)
//   - oauth_link_intents / oauth_step_up_challenges / oauth_step_up_sessions:
//     locked auth material (null API rules), excluded from soft-delete
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		users.OAuth2.Enabled = true
		users.OAuth2.MappedFields.Name = "display_name"
		users.OAuth2.MappedFields.AvatarURL = ""
		users.OAuth2.MappedFields.Username = ""
		users.OAuth2.MappedFields.Id = ""

		users.Fields.Add(&core.BoolField{
			Name:   "has_cognos_password",
			Hidden: true,
		})

		if err := app.Save(users); err != nil {
			return err
		}

		// Existing Accounts were all created with a Cognos password.
		_, err = app.DB().NewQuery("UPDATE users SET has_cognos_password = 1").Execute()
		if err != nil {
			return err
		}

		jsonData := `[
			{
				"id": "oauthlinkint001",
				"name": "oauth_link_intents",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "oliuser0000001", "name": "user", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "oliinhash00001", "name": "intent_hash", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 128, "pattern": "" }
					},
					{
						"system": false, "id": "oliprov0000001", "name": "provider", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 64, "pattern": "" }
					},
					{
						"system": false, "id": "oliexp00000001", "name": "expires_at", "type": "date",
						"required": true, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "olicons0000001", "name": "consumed_at", "type": "date",
						"required": false, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "olicrt00000001", "name": "created", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": false
					},
					{
						"system": false, "id": "oliupd00000001", "name": "updated", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": true
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_oauth_link_intents_hash` + "`" + ` ON ` + "`" + `oauth_link_intents` + "`" + ` (` + "`" + `intent_hash` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_oauth_link_intents_user` + "`" + ` ON ` + "`" + `oauth_link_intents` + "`" + ` (` + "`" + `user` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			},
			{
				"id": "oauthstepch001",
				"name": "oauth_step_up_challenges",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "oscuser0000001", "name": "user", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "oscchhash00001", "name": "challenge_hash", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 128, "pattern": "" }
					},
					{
						"system": false, "id": "oscprov0000001", "name": "provider", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 64, "pattern": "" }
					},
					{
						"system": false, "id": "oscexp00000001", "name": "expires_at", "type": "date",
						"required": true, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "oscconf0000001", "name": "confirmed_at", "type": "date",
						"required": false, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "osccons0000001", "name": "consumed_at", "type": "date",
						"required": false, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "osccrt00000001", "name": "created", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": false
					},
					{
						"system": false, "id": "oscupd00000001", "name": "updated", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": true
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_oauth_step_up_challenges_hash` + "`" + ` ON ` + "`" + `oauth_step_up_challenges` + "`" + ` (` + "`" + `challenge_hash` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_oauth_step_up_challenges_user` + "`" + ` ON ` + "`" + `oauth_step_up_challenges` + "`" + ` (` + "`" + `user` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			},
			{
				"id": "oauthstepses001",
				"name": "oauth_step_up_sessions",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "ossuser0000001", "name": "user", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "osssessh000001", "name": "session_hash", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 128, "pattern": "" }
					},
					{
						"system": false, "id": "ossprov0000001", "name": "provider", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 64, "pattern": "" }
					},
					{
						"system": false, "id": "ossexp00000001", "name": "expires_at", "type": "date",
						"required": true, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "osscons0000001", "name": "consumed_at", "type": "date",
						"required": false, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "osscrt00000001", "name": "created", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": false
					},
					{
						"system": false, "id": "ossupd00000001", "name": "updated", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": true
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_oauth_step_up_sessions_hash` + "`" + ` ON ` + "`" + `oauth_step_up_sessions` + "`" + ` (` + "`" + `session_hash` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_oauth_step_up_sessions_user` + "`" + ` ON ` + "`" + `oauth_step_up_sessions` + "`" + ` (` + "`" + `user` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			}
		]`

		return importLegacyCollections(app, jsonData, false)
	}, func(app core.App) error {
		for _, name := range []string{
			"oauth_step_up_sessions",
			"oauth_step_up_challenges",
			"oauth_link_intents",
		} {
			if collection, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(collection); err != nil {
					return err
				}
			}
		}

		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.OAuth2.Enabled = false
		users.OAuth2.Providers = nil
		users.OAuth2.MappedFields.Name = ""
		users.Fields.RemoveByName("has_cognos_password")
		return app.Save(users)
	})
}
