package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the optional `organisation` relation to projects: a Project is either
// personal (field empty — bills the creator's user_billing) or org-owned
// (bills org_billing, a later slice). Deliberately NOT cascadeDelete: deleting
// an Organisation must never destroy its members' Projects (encrypted content
// the server could not recreate). PocketBase instead clears the dangling
// reference, so surviving projects fall back to personal scope.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}

		organisations, err := app.FindCollectionByNameOrId("organisations")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "projorg0000001",
			"name": "organisation",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "`+organisations.Id+`",
				"cascadeDelete": false,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}

		collection.Fields.RemoveById("projorg0000001")
		return app.Save(collection)
	})
}
