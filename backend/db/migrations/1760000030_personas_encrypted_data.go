package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("personas")
		if err != nil {
			collection, err = app.FindCollectionByNameOrId("agents")
			if err != nil {
				return err
			}
		}

		collection.Name = "personas"
		collection.Fields.RemoveByName("name")
		collection.Fields.RemoveByName("slug")
		collection.Fields.RemoveByName("description")
		collection.Fields.RemoveByName("system_prompt")

		if collection.Fields.GetByName("user") == nil {
			if err := addLegacyField(app, collection, `{
				"system": false,
				"id": "persuser001",
				"name": "user",
				"type": "relation",
				"required": true,
				"presentable": false,
				"unique": false,
				"options": {
					"collectionId": "_pb_users_auth_",
					"cascadeDelete": true,
					"minSelect": null,
					"maxSelect": 1,
					"displayFields": null
				}
			}`); err != nil {
				return err
			}
		}

		if collection.Fields.GetByName("data") == nil {
			if err := addLegacyField(app, collection, `{
				"system": false,
				"id": "persdata001",
				"name": "data",
				"type": "text",
				"required": true,
				"presentable": false,
				"unique": false,
				"options": {
					"min": null,
					"max": 1048576,
					"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
				}
			}`); err != nil {
				return err
			}
		}

		collection.ListRule = stringPtr("@request.auth.id != \"\" && @request.auth.id = user")
		collection.ViewRule = stringPtr("@request.auth.id != \"\" && @request.auth.id = user")
		collection.CreateRule = stringPtr("@request.auth.id != \"\" && @request.auth.id = @request.body.user && @request.body.id:isset = false && @request.body.created:isset = false && @request.body.updated:isset = false && @request.body.data:isset = true")
		collection.UpdateRule = stringPtr("@request.auth.id != \"\" && @request.auth.id = user")
		collection.DeleteRule = stringPtr("@request.auth.id != \"\" && @request.auth.id = user")

		return app.Save(collection)
	}, func(app core.App) error {
		return nil
	})
}
