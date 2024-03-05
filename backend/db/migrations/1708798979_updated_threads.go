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

		collection, err := dao.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		// add
		new_key := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
			"system": false,
			"id": "r9wj7pqo",
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
		}`), new_key)
		if err != nil {
			return err
		}
		collection.Schema.AddField(new_key)

		// update
		edit_data := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
			"system": false,
			"id": "msxvlyrc",
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
		}`), edit_data)
		if err != nil {
			return err
		}
		collection.Schema.AddField(edit_data)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		// remove
		collection.Schema.RemoveField("r9wj7pqo")

		// update
		edit_data := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
			"system": false,
			"id": "msxvlyrc",
			"name": "data",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), edit_data)
		if err != nil {
			return err
		}
		collection.Schema.AddField(edit_data)

		return dao.SaveCollection(collection)
	})
}
