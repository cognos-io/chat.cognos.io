package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the preferred_theme field to the users collection.
//
// Like preferred_language, the appearance theme is not sensitive and is
// deliberately stored in plaintext on the user record (not in the encrypted
// preferences payload) so it can be applied before the vault is unlocked — the
// app needs it on the very first paint to avoid a light/dark flash — and so the
// choice follows the user across devices the moment they sign in.
//
// Allowed values: light | dark | system. Optional: a blank value means "no
// saved preference yet", in which case the app falls back to the device's
// colour-scheme preference (system).
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("_pb_users_auth_")
		if err != nil {
			return err
		}

		field := `{
			"id": "txtpreftheme1",
			"name": "preferred_theme",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"min": null, "max": 6, "pattern": "^(light|dark|system)$"}
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

		if field := collection.Fields.GetByName("preferred_theme"); field != nil {
			collection.Fields.RemoveByName("preferred_theme")
		}

		return app.Save(collection)
	})
}
