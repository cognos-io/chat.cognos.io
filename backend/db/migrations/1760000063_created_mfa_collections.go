package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Create the authenticator-app MFA collections (docs/specs/mfa-and-passkeys.md).
// All four are pure auth material: every collection API rule is locked (null),
// so they are unreachable through PocketBase's generic record API. Access flows
// only through the first-party /api/v1/mfa and /api/v1/auth/mfa handlers. They
// are also excluded from soft-delete snapshots (see internal/hooks) — deleted
// auth material must disappear immediately, not linger in a copy.
//
//   - user_mfa_totp: one row per user (unique). Holds the TOTP seed encrypted at
//     rest with a server-held key; never the plaintext seed.
//   - mfa_auth_sessions: short-lived proof that the password factor passed,
//     pending a second factor. Single-use; carries its own failure counter so a
//     session burns after too many bad codes.
//   - mfa_recovery_codes: one-use account-access fallback, stored as hashes only.
//   - mfa_trusted_devices: "remember this device" tokens (hash only) that waive
//     the second factor for a bounded window. They never unlock data.
func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "usermfatotp0001",
				"name": "user_mfa_totp",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "umtuser0000001", "name": "user", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "umtsecct000001", "name": "secret_ciphertext", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 1024, "pattern": "" }
					},
					{
						"system": false, "id": "umtsecnc000001", "name": "secret_nonce", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 256, "pattern": "" }
					},
					{
						"system": false, "id": "umtkeyid000001", "name": "secret_key_id", "type": "text",
						"required": true, "presentable": false, "unique": false,
						"options": { "min": 1, "max": 128, "pattern": "" }
					},
					{
						"system": false, "id": "umtalgo0000001", "name": "algorithm", "type": "text",
						"required": false, "presentable": false, "unique": false,
						"options": { "min": 0, "max": 16, "pattern": "" }
					},
					{
						"system": false, "id": "umtdigit000001", "name": "digits", "type": "number",
						"required": false, "presentable": false, "unique": false,
						"options": { "min": 0, "max": null, "noDecimal": true }
					},
					{
						"system": false, "id": "umtperiod00001", "name": "period_seconds", "type": "number",
						"required": false, "presentable": false, "unique": false,
						"options": { "min": 0, "max": null, "noDecimal": true }
					},
					{
						"system": false, "id": "umtstep0000001", "name": "last_accepted_step", "type": "number",
						"required": false, "presentable": false, "unique": false,
						"options": { "min": 0, "max": null, "noDecimal": true }
					},
					{
						"system": false, "id": "umtverif000001", "name": "verified_at", "type": "date",
						"required": false, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "umtdisab000001", "name": "disabled_at", "type": "date",
						"required": false, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "umtlast0000001", "name": "last_used_at", "type": "date",
						"required": false, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "umtcrt00000001", "name": "created", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": false
					},
					{
						"system": false, "id": "umtupd00000001", "name": "updated", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": true
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_user_mfa_totp_user` + "`" + ` ON ` + "`" + `user_mfa_totp` + "`" + ` (` + "`" + `user` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			},
			{
				"id": "mfaauthsess0001",
				"name": "mfa_auth_sessions",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "masuser0000001", "name": "user", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "mashash0000001", "name": "session_hash", "type": "text",
						"required": true, "presentable": false, "unique": true,
						"options": { "min": 1, "max": 256, "pattern": "" }
					},
					{
						"system": false, "id": "masfactor00001", "name": "first_factor", "type": "text",
						"required": false, "presentable": false, "unique": false,
						"options": { "min": 0, "max": 32, "pattern": "" }
					},
					{
						"system": false, "id": "masfail0000001", "name": "failed_attempts", "type": "number",
						"required": false, "presentable": false, "unique": false,
						"options": { "min": 0, "max": null, "noDecimal": true }
					},
					{
						"system": false, "id": "masexp00000001", "name": "expires_at", "type": "date",
						"required": true, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "mascons000001", "name": "consumed_at", "type": "date",
						"required": false, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "mascrt0000001", "name": "created", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": false
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_mfa_auth_sessions_hash` + "`" + ` ON ` + "`" + `mfa_auth_sessions` + "`" + ` (` + "`" + `session_hash` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_mfa_auth_sessions_user` + "`" + ` ON ` + "`" + `mfa_auth_sessions` + "`" + ` (` + "`" + `user` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			},
			{
				"id": "mfarecvcode0001",
				"name": "mfa_recovery_codes",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "mrcuser0000001", "name": "user", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "mrchash0000001", "name": "code_hash", "type": "text",
						"required": true, "presentable": false, "unique": true,
						"options": { "min": 1, "max": 256, "pattern": "" }
					},
					{
						"system": false, "id": "mrcused0000001", "name": "used_at", "type": "date",
						"required": false, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "mrccrt0000001", "name": "created", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": false
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_mfa_recovery_codes_hash` + "`" + ` ON ` + "`" + `mfa_recovery_codes` + "`" + ` (` + "`" + `code_hash` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_mfa_recovery_codes_user` + "`" + ` ON ` + "`" + `mfa_recovery_codes` + "`" + ` (` + "`" + `user` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			},
			{
				"id": "mfatrustdev0001",
				"name": "mfa_trusted_devices",
				"type": "base",
				"system": false,
				"fields": [
					{
						"system": false, "id": "mtduser0000001", "name": "user", "type": "relation",
						"required": true, "presentable": false, "unique": false,
						"options": { "collectionId": "_pb_users_auth_", "cascadeDelete": true, "minSelect": null, "maxSelect": 1, "displayFields": null }
					},
					{
						"system": false, "id": "mtdhash0000001", "name": "token_hash", "type": "text",
						"required": true, "presentable": false, "unique": true,
						"options": { "min": 1, "max": 256, "pattern": "" }
					},
					{
						"system": false, "id": "mtdlabel000001", "name": "label", "type": "text",
						"required": false, "presentable": false, "unique": false,
						"options": { "min": 0, "max": 128, "pattern": "" }
					},
					{
						"system": false, "id": "mtdexp00000001", "name": "expires_at", "type": "date",
						"required": true, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "mtdlast0000001", "name": "last_used_at", "type": "date",
						"required": false, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "mtdrevok000001", "name": "revoked_at", "type": "date",
						"required": false, "presentable": false, "unique": false, "options": {}
					},
					{
						"system": false, "id": "mtdcrt0000001", "name": "created", "type": "autodate",
						"presentable": false, "hidden": false, "onCreate": true, "onUpdate": false
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_mfa_trusted_devices_hash` + "`" + ` ON ` + "`" + `mfa_trusted_devices` + "`" + ` (` + "`" + `token_hash` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_mfa_trusted_devices_user` + "`" + ` ON ` + "`" + `mfa_trusted_devices` + "`" + ` (` + "`" + `user` + "`" + `)"
				],
				"listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null, "options": {}
			}
		]`

		return importLegacyCollections(app, jsonData, false)
	}, func(app core.App) error {
		// Drop in reverse dependency order (none reference each other, but keep it
		// deterministic).
		for _, name := range []string{"mfa_trusted_devices", "mfa_recovery_codes", "mfa_auth_sessions", "user_mfa_totp"} {
			if collection, err := app.FindCollectionByNameOrId(name); err == nil {
				if err := app.Delete(collection); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
