package migrations

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models/schema"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		// update
		edit_conversation := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
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
		}`), edit_conversation)
		if err != nil {
			return err
		}
		collection.Schema.AddField(edit_conversation)

		// update
		edit_parent_message := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
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
		}`), edit_parent_message)
		if err != nil {
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

		// update
		edit_conversation := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
			"system": false,
			"id": "rqegjuus",
			"name": "conversation_id",
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
		}`), edit_conversation)
		if err != nil {
			return err
		}
		collection.Schema.AddField(edit_conversation)

		// update
		edit_parent_message := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
			"system": false,
			"id": "nciypmmv",
			"name": "parent_id",
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
		}`), edit_parent_message)
		if err != nil {
			return err
		}
		collection.Schema.AddField(edit_parent_message)

		return dao.SaveCollection(collection)
	})
}
