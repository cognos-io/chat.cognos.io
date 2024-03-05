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

		collection, err := dao.FindCollectionByNameOrId("kx3ewd64kz2os37")
		if err != nil {
			return err
		}

		// update
		edit_secret_key := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
			"system": false,
			"id": "naos08c4",
			"name": "secret_key",
			"type": "text",
			"required": true,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
			}
		}`), edit_secret_key)
		if err != nil {
			return err
		}
		collection.Schema.AddField(edit_secret_key)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("kx3ewd64kz2os37")
		if err != nil {
			return err
		}

		// update
		edit_secret_key := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
			"system": false,
			"id": "naos08c4",
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
		}`), edit_secret_key)
		if err != nil {
			return err
		}
		collection.Schema.AddField(edit_secret_key)

		return dao.SaveCollection(collection)
	})
}
