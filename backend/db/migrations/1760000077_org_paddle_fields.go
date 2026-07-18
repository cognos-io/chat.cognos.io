package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds org-aware fields to the Paddle bookkeeping collections:
//   - refunds.organisation  (optional relation) so adjustment events can be
//     attributed to an Organisation.
//   - organisations.paddle_customer_id (text) so portal + webhook resolution
//     can map a Paddle customer back to an org.
func init() {
	m.Register(func(app core.App) error {
		refunds, err := app.FindCollectionByNameOrId("refunds")
		if err != nil {
			return err
		}
		if refunds.Fields.GetByName("organisation") == nil {
			if err := addLegacyField(app, refunds, `{
				"system": false,
				"id": "relrefndorg01",
				"name": "organisation",
				"type": "relation",
				"required": false,
				"presentable": false,
				"unique": false,
				"options": {
					"collectionId": "organisations01",
					"cascadeDelete": false,
					"minSelect": null,
					"maxSelect": 1,
					"displayFields": null
				}
			}`); err != nil {
				return err
			}
		}
		if err := app.Save(refunds); err != nil {
			return err
		}

		organisations, err := app.FindCollectionByNameOrId("organisations")
		if err != nil {
			return err
		}
		if organisations.Fields.GetByName("paddle_customer_id") == nil {
			if err := addLegacyField(app, organisations, `{
				"system": false,
				"id": "orgpaddlecust1",
				"name": "paddle_customer_id",
				"type": "text",
				"required": false,
				"presentable": false,
				"unique": false,
				"options": {"min": null, "max": null, "pattern": ""}
			}`); err != nil {
				return err
			}
		}
		return app.Save(organisations)
	}, func(app core.App) error {
		refunds, err := app.FindCollectionByNameOrId("refunds")
		if err == nil {
			refunds.Fields.RemoveByName("organisation")
			_ = app.Save(refunds)
		}
		organisations, err := app.FindCollectionByNameOrId("organisations")
		if err == nil {
			organisations.Fields.RemoveByName("paddle_customer_id")
			_ = app.Save(organisations)
		}
		return nil
	})
}
