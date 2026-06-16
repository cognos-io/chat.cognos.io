package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds a `past_due` flag to user_billing (spec §5.4, §6). Paddle's
// subscription.past_due fires when a renewal payment fails and dunning begins;
// we keep the user on their plan through the grace window but surface the
// failed-payment banner so they can update their card. subscription.activated
// (dunning recovery) clears it; subscription.canceled (dunning gave up) moves
// them to inactive.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("user_billing")
		if err != nil {
			return err
		}

		field := `{
			"id": "boolpastdue1",
			"name": "past_due",
			"type": "bool",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {}
		}`
		if err := addLegacyField(app, collection, field); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("user_billing")
		if err != nil {
			return err
		}
		if field := collection.Fields.GetByName("past_due"); field != nil {
			collection.Fields.RemoveByName("past_due")
		}
		return app.Save(collection)
	})
}
