package migrations

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models/schema"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\" \n&& conversation.creator = @request.auth.id")

		collection.CreateRule = types.Pointer("@request.auth.id != \"\"\n&& conversation.creator = @request.auth.id\n&& (parent_message = \"\" || (parent_message.conversation = conversation))")

		// remove
		collection.Schema.RemoveField("8l6lqqqv")

		// update
		edit_conversation := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
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
		}`), edit_conversation); err != nil {
			return err
		}
		collection.Schema.AddField(edit_conversation)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\" &&\n// User is a viewer, editor or admin for the given conversation\n@collection.participants.conversation = conversation &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' || @collection.participants.role = 'Admin') ")

		collection.CreateRule = types.Pointer("@request.auth.id != \"\" &&\n// User is an editor or admin for the the given conversation\n@collection.participants.conversation = conversation &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Editor' || @collection.participants.role = 'Admin') \n// Check the parent message is also in the same conversation\n(parent_message = \"\" || (parent_message.conversation = conversation))")

		// add
		del_key := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
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
		}`), del_key); err != nil {
			return err
		}
		collection.Schema.AddField(del_key)

		// update
		edit_conversation := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
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
		}`), edit_conversation); err != nil {
			return err
		}
		collection.Schema.AddField(edit_conversation)

		return dao.SaveCollection(collection)
	})
}
