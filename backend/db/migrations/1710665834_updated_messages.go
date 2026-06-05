package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\" \n&& conversation.creator = @request.auth.id")

		collection.CreateRule = types.Pointer("@request.auth.id != \"\"\n&& conversation.creator = @request.auth.id\n&& (parent_message = \"\" || (parent_message.conversation = conversation))")

		// remove
		collection.Fields.RemoveById("8l6lqqqv")

		// update
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "rqegjuus",
			"name": "conversation",
			"type": "relation",
			"required": true,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "23wjzzeeb4qilr9",
				"cascadeDelete": true,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\" &&\n// User is a viewer, editor or admin for the given conversation\n@collection.participants.conversation = conversation &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' || @collection.participants.role = 'Admin') ")

		collection.CreateRule = types.Pointer("@request.auth.id != \"\" &&\n// User is an editor or admin for the the given conversation\n@collection.participants.conversation = conversation &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Editor' || @collection.participants.role = 'Admin') \n// Check the parent message is also in the same conversation\n(parent_message = \"\" || (parent_message.conversation = conversation))")

		// add
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "8l6lqqqv",
			"name": "key",
			"type": "text",
			"required": true,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
			}
		}`); err != nil {
			return err
		}

		// update
		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "rqegjuus",
			"name": "conversation",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "23wjzzeeb4qilr9",
				"cascadeDelete": true,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	})
}
