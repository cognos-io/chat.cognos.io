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

		collection, err := dao.FindCollectionByNameOrId("3v0m8v3xtw1286r")
		if err != nil {
			return err
		}

		// remove
		collection.Schema.RemoveField("aefq0xyr")

		// add
		new_thread_id := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
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
		}`), new_thread_id)
		if err != nil {
			return err
		}
		collection.Schema.AddField(new_thread_id)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("3v0m8v3xtw1286r")
		if err != nil {
			return err
		}

		// add
		del_conversation := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
			"system": false,
			"id": "aefq0xyr",
			"name": "conversation",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "23wjzzeeb4qilr9",
				"cascadeDelete": false,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`), del_conversation)
		if err != nil {
			return err
		}
		collection.Schema.AddField(del_conversation)

		// remove
		collection.Schema.RemoveField("vy8bto8z")

		return dao.SaveCollection(collection)
	})
}
