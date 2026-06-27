package migrations

import (
	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// display_name is the user-facing model name shown in the composer/model
// picker. The existing `name` keeps the full technical form (provider hints,
// quantization, instruction-tuning tags) for operators; display_name strips
// that jargon for non-technical users. Backfilled from `name` via
// catalogue.FriendlyModelName; new/edited rows can override it by hand.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{"id":"aimoddispnm01","name":"display_name","type":"text","required":false,"presentable":false,"unique":false,"options":{}}`); err != nil {
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
			if record.GetString("display_name") != "" {
				continue
			}
			record.Set("display_name", catalogue.FriendlyModelName(record.GetString("name")))
			if err := app.Save(record); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}
		collection.Fields.RemoveById("aimoddispnm01")
		return app.Save(collection)
	})
}
