package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the icon-based avatar fields to the users collection. Rather than upload
// a photo, users pick a Material Symbol icon and a colour (mirroring the persona
// avatars), so these are two short plaintext strings — not sensitive, and shown
// to other participants in shared chats. Both optional: users without a chosen
// avatar fall back to initials.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("_pb_users_auth_")
		if err != nil {
			return err
		}

		fields := []string{
			`{
				"id": "txtavataric1",
				"name": "avatar_icon",
				"type": "text",
				"required": false,
				"presentable": false,
				"unique": false,
				"options": {"min": null, "max": 60, "pattern": ""}
			}`,
			`{
				"id": "txtavatarcl1",
				"name": "avatar_color",
				"type": "text",
				"required": false,
				"presentable": false,
				"unique": false,
				"options": {"min": null, "max": 30, "pattern": ""}
			}`,
		}

		for _, field := range fields {
			if err := addLegacyField(app, collection, field); err != nil {
				return err
			}
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("_pb_users_auth_")
		if err != nil {
			return err
		}

		for _, name := range []string{"avatar_icon", "avatar_color"} {
			if field := collection.Fields.GetByName(name); field != nil {
				collection.Fields.RemoveByName(name)
			}
		}

		return app.Save(collection)
	})
}
