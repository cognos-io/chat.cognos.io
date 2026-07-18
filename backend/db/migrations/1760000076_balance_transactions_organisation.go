package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the optional `organisation` relation to balance_transactions (spec
// docs/specs/organisations.md §6.5): usage in an org-owned Project is
// attributed to the Organisation for pooled settlement while keeping user_id
// as the acting Account (audit + per-member metadata dashboards). Personal
// usage leaves the field empty. Deliberately NOT cascadeDelete — ledger rows
// are financial audit data and must survive an Organisation row disappearing,
// matching 1760000033's stance for user_id.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("balance_transactions")
		if err != nil {
			return err
		}

		organisations, err := app.FindCollectionByNameOrId("organisations")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "relbaltxorg001",
			"name": "organisation",
			"type": "relation",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"collectionId": "`+organisations.Id+`",
				"cascadeDelete": false,
				"minSelect": null,
				"maxSelect": 1,
				"displayFields": null
			}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("balance_transactions")
		if err != nil {
			return err
		}

		collection.Fields.RemoveById("relbaltxorg001")
		return app.Save(collection)
	})
}
