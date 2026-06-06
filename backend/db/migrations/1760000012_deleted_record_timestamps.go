package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("deleted")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "delat001",
			"name": "deleted_at",
			"type": "date",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": "",
				"max": ""
			}
		}`); err != nil {
			return err
		}

		if err := app.Save(collection); err != nil {
			return err
		}

		now := types.NowDateTime()
		records, err := app.FindAllRecords(collection)
		if err != nil {
			return err
		}

		for _, record := range records {
			if record.GetDateTime("deleted_at").IsZero() {
				record.Set("deleted_at", now)
				if err := app.Save(record); err != nil {
					return err
				}
			}
		}

		return nil
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("deleted")
		if err != nil {
			return err
		}

		collection.Fields.RemoveById("delat001")

		return app.Save(collection)
	})
}
