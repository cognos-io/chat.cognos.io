package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds a protected `attachment` file field to messages for encrypted generated
// images. The field is protected: files are not publicly addressable and are
// only reachable via a short-lived file token, gated by the messages
// collection's existing participant access rules. The stored bytes are always
// ciphertext (a `.enc` blob), so no mime-type restriction is applied.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("messages")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"id": "msgattach001",
			"name": "attachment",
			"type": "file",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"mimeTypes": [],
				"thumbs": null,
				"maxSelect": 1,
				"maxSize": 15728640,
				"protected": true
			}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("messages")
		if err != nil {
			return err
		}

		collection.Fields.RemoveById("msgattach001")
		return app.Save(collection)
	})
}
