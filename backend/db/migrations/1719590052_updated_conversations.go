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

		// update
		edit_expiry_duration := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "4jng92aq",
			"name": "expiry_duration",
			"type": "select",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"maxSelect": 1,
				"values": [
					"24h",
					"168h",
					"2160h",
					"4320h"
				]
			}
		}`), edit_expiry_duration); err != nil {
			return err
		}
		collection.Schema.AddField(edit_expiry_duration)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		// update
		edit_expiry_duration := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "4jng92aq",
			"name": "expiry_duration",
			"type": "select",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"maxSelect": 1,
				"values": [
					"24h",
					"7d",
					"90d",
					"6m"
				]
			}
		}`), edit_expiry_duration); err != nil {
			return err
		}
		collection.Schema.AddField(edit_expiry_duration)

		return dao.SaveCollection(collection)
	})
}
