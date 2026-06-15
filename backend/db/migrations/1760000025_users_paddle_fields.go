package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the billing + business-invoicing fields to the users collection that the
// Paddle integration needs (spec §9.1). All are optional: existing users keep
// working, and the values are populated as users set a display name or buy a
// plan. These never hold card data — only Paddle's opaque customer id.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("_pb_users_auth_")
		if err != nil {
			return err
		}

		fields := []string{
			`{
				"id": "txtdisplayn1",
				"name": "display_name",
				"type": "text",
				"required": false,
				"presentable": false,
				"unique": false,
				"options": {"min": null, "max": 120, "pattern": ""}
			}`,
			`{
				"id": "boolrefundu1",
				"name": "refund_used",
				"type": "bool",
				"required": false,
				"presentable": false,
				"unique": false,
				"options": {}
			}`,
			`{
				"id": "txtpdlcust01",
				"name": "paddle_customer_id",
				"type": "text",
				"required": false,
				"presentable": false,
				"unique": false,
				"options": {"min": null, "max": null, "pattern": ""}
			}`,
			`{
				"id": "txtbizname01",
				"name": "business_name",
				"type": "text",
				"required": false,
				"presentable": false,
				"unique": false,
				"options": {"min": null, "max": null, "pattern": ""}
			}`,
			`{
				"id": "txtbizvat001",
				"name": "business_vat_id",
				"type": "text",
				"required": false,
				"presentable": false,
				"unique": false,
				"options": {"min": null, "max": null, "pattern": ""}
			}`,
			`{
				"id": "txtbizcntry1",
				"name": "business_country",
				"type": "text",
				"required": false,
				"presentable": false,
				"unique": false,
				"options": {"min": null, "max": 2, "pattern": ""}
			}`,
		}

		for _, field := range fields {
			if err := addLegacyField(app, collection, field); err != nil {
				return err
			}
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("_pb_users_auth_")
		if err != nil {
			return err
		}

		for _, name := range []string{
			"display_name", "refund_used", "paddle_customer_id",
			"business_name", "business_vat_id", "business_country",
		} {
			if field := collection.Fields.GetByName(name); field != nil {
				collection.Fields.RemoveByName(name)
			}
		}

		return app.Save(collection)
	})
}
