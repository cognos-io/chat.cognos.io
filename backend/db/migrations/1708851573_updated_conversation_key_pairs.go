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
		collection.Schema.RemoveField("o7wsynwi")

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("3v0m8v3xtw1286r")
		if err != nil {
			return err
		}

		// add
		del_secret_key := &schema.SchemaField{}
		json.Unmarshal([]byte(`{
			"system": false,
			"id": "o7wsynwi",
			"name": "secret_key",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), del_secret_key)
		collection.Schema.AddField(del_secret_key)

		return dao.SaveCollection(collection)
	})
}
