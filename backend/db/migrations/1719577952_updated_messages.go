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
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.UpdateRule = nil

		collection.DeleteRule = types.Pointer("@request.auth.id != \"\" \n&& conversation.creator = @request.auth.id")

		// update
		edit_data := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "wbuzpppe",
			"name": "data",
			"type": "text",
			"required": true,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
			}
		}`), edit_data); err != nil {
			return err
		}
		collection.Schema.AddField(edit_data)

		// update
		edit_parent_message := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "nciypmmv",
			"name": "parent_message",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "v893vvhgp688kie",
				"cascadeDelete": false,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`), edit_parent_message); err != nil {
			return err
		}
		collection.Schema.AddField(edit_parent_message)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.UpdateRule = types.Pointer("@request.auth.id != \"\"\n&& conversation.creator = @request.auth.id\n&& @request.data.data:isset = true\n&& @request.data.id:isset = false\n&& @request.data.created:isset = false\n&& @request.data.updated:isset = false\n&& @request.data.conversation:isset = false\n&& @request.data.parent_message:isset = false")

		collection.DeleteRule = nil

		// update
		edit_data := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "wbuzpppe",
			"name": "data",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
			}
		}`), edit_data); err != nil {
			return err
		}
		collection.Schema.AddField(edit_data)

		// update
		edit_parent_message := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "nciypmmv",
			"name": "parent_message",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "v893vvhgp688kie",
				"cascadeDelete": true,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`), edit_parent_message); err != nil {
			return err
		}
		collection.Schema.AddField(edit_parent_message)

		return dao.SaveCollection(collection)
	})
}
