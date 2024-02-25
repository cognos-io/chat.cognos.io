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
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("3v0m8v3xtw1286r")
		if err != nil {
			return err
		}

		collection.Name = "conversation_key_pairs"

		// update
		edit_conversation_id := &schema.SchemaField{}
		json.Unmarshal([]byte(`{
			"system": false,
			"id": "vy8bto8z",
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
		}`), edit_conversation_id)
		collection.Schema.AddField(edit_conversation_id)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("3v0m8v3xtw1286r")
		if err != nil {
			return err
		}

		collection.Name = "thread_key_pairs"

		// update
		edit_conversation_id := &schema.SchemaField{}
		json.Unmarshal([]byte(`{
			"system": false,
			"id": "vy8bto8z",
			"name": "thread_id",
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
		}`), edit_conversation_id)
		collection.Schema.AddField(edit_conversation_id)

		return dao.SaveCollection(collection)
	})
}
