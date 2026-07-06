package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// released_at records when a model was first released upstream. It drives the
// composer's "Newest" sort so users can find the latest models. The column is
// nullable and curated: operators may set it by hand, and the Requesty sync
// only ever backfills it when empty (it never overwrites a curated value, since
// a manual date may correct a wrong or missing upstream one). Models with no
// date simply sort last under "Newest". No backfill here — existing rows start
// empty and are populated by curation or the next sync.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{"id":"aimodrelsat1","name":"released_at","type":"date","required":false,"presentable":false,"unique":false,"options":{}}`); err != nil {
			return err
		}
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}
		collection.Fields.RemoveById("aimodrelsat1")
		return app.Save(collection)
	})
}
