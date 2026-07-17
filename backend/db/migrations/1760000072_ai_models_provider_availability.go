package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// provider_available records whether the Provider currently exposes a Model.
// It is deliberately separate from enabled: provider availability is synced,
// while enabled remains an operator-owned local override. The effective
// catalogue therefore requires both flags, so neither side destroys the
// other's intent.
//
// Existing Models are backfilled available to preserve current behaviour.
// Requesty's next successful catalogue sync corrects its Models from the live
// upstream list. This is an expand-only migration; the field is not removed on
// rollback because deployed code may already depend on the split state.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{"id":"aimodprovav1","name":"provider_available","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`); err != nil {
			return err
		}
		if err := app.Save(collection); err != nil {
			return err
		}

		records, err := app.FindAllRecords("ai_models")
		if err != nil {
			return err
		}
		for _, record := range records {
			record.Set("provider_available", true)
			if err := app.Save(record); err != nil {
				return err
			}
		}
		return nil
	}, nil)
}
