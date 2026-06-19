package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the preferred_language field to the users collection.
//
// Unlike chat content (which is end-to-end encrypted), the UI language is not
// sensitive and is deliberately stored in plaintext on the user record so it
// can be applied before the vault is unlocked (e.g. it follows the user across
// devices the moment they sign in) and is available server-side for localised
// emails and the Paddle checkout locale.
//
// Stored as an IETF-style language tag base (ISO 639-1, e.g. "en", "de"). The
// app validates against its supported set; the column just persists the choice.
// Optional: a blank value means "fall back to browser/Accept-Language".
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("_pb_users_auth_")
		if err != nil {
			return err
		}

		field := `{
			"id": "txtpreflang1",
			"name": "preferred_language",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"min": null, "max": 10, "pattern": "^[a-z]{2}(-[A-Z]{2})?$"}
		}`

		if err := addLegacyField(app, collection, field); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("_pb_users_auth_")
		if err != nil {
			return err
		}

		if field := collection.Fields.GetByName("preferred_language"); field != nil {
			collection.Fields.RemoveByName("preferred_language")
		}

		return app.Save(collection)
	})
}
