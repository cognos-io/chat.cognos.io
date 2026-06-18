package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// The unlock key now derives from the Account Key alone (account_key_v2); the
// password is authentication-only. Update the unlock_scheme field pattern and
// the create rule so the backend accepts v2 records. Launch is greenfield, so
// the legacy password_account_key_v1 value is dropped rather than carried.
const userKeyPairCreateRuleV2 = "@request.auth.id != \"\" && \n@request.auth.id = @request.body.user &&\n// Additional validation\n@request.body.id:isset = false &&\n@request.body.created:isset = false &&\n@request.body.updated:isset = false &&\n@request.body.public_key:isset = true &&\n@request.body.secret_key:isset = true &&\n@request.body.password_salt:isset = true &&\n@request.body.unlock_scheme:isset = true &&\n@request.body.unlock_scheme = \"account_key_v2\" &&\n@request.body.record_mac:isset = true"

const userKeyPairCreateRuleV1 = "@request.auth.id != \"\" && \n@request.auth.id = @request.body.user &&\n// Additional validation\n@request.body.id:isset = false &&\n@request.body.created:isset = false &&\n@request.body.updated:isset = false &&\n@request.body.public_key:isset = true &&\n@request.body.secret_key:isset = true &&\n@request.body.password_salt:isset = true &&\n@request.body.unlock_scheme:isset = true &&\n@request.body.unlock_scheme = \"password_account_key_v1\" &&\n@request.body.record_mac:isset = true"

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("user_key_pairs")
		if err != nil {
			return err
		}

		// Replaces the existing field (same id) with the v2 pattern.
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "user_key_pairs_unlock_scheme",
			"name": "unlock_scheme",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": "^(account_key_v2)?$"
			}
		}`); err != nil {
			return err
		}

		collection.CreateRule = types.Pointer(userKeyPairCreateRuleV2)

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("user_key_pairs")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "user_key_pairs_unlock_scheme",
			"name": "unlock_scheme",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": "^(password_account_key_v1)?$"
			}
		}`); err != nil {
			return err
		}

		collection.CreateRule = types.Pointer(userKeyPairCreateRuleV1)

		return app.Save(collection)
	})
}
