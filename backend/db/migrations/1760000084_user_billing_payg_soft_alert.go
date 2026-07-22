package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds payg_soft_alert_cycle_start_at to user_billing (OP-014).
//
// When a PAYG Account's cycle usage reaches the monthly minimum we surface a
// one-per-cycle soft warning. Acknowledging it stamps this field with the
// current paddle_cycle_start_at so the same cycle stays quiet; a new cycle
// (different start) re-arms the alert. Informational only — never a gate.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("user_billing")
		if err != nil {
			return err
		}

		field := `{
			"id": "datepaygsalert1",
			"name": "payg_soft_alert_cycle_start_at",
			"type": "date",
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
		if field := collection.Fields.GetByName("payg_soft_alert_cycle_start_at"); field != nil {
			collection.Fields.RemoveByName("payg_soft_alert_cycle_start_at")
		}
		return app.Save(collection)
	})
}
