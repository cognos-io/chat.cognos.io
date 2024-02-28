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

		// add
		new_user_id := &schema.SchemaField{}
		err = json.Unmarshal([]byte(`{
			"system": false,
			"id": "ohmtgv8t",
			"name": "user_id",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "_pb_users_auth_",
				"cascadeDelete": false,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`), new_user_id)
		if err != nil {
			return err
		}
		collection.Schema.AddField(new_user_id)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("kx3ewd64kz2os37")
		if err != nil {
			return err
		}

		// remove
		collection.Schema.RemoveField("ohmtgv8t")

		return dao.SaveCollection(collection)
	})
}
