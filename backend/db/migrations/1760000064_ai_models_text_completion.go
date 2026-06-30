package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds supports_text_completion to ai_models and seeds it. The catalogue
// previously had no way to say "this model can't answer a normal text
// completion", so an image-generation-only model (gemini-2.5-flash-image) stayed
// eligible for the /complete path once the image tool was turned off — the
// request reached the provider and errored (docs/bugs/2026-06-30-image-only-
// model-text-completion.md).
//
// The flag defaults false so a freshly curated image-only model is safe by
// default. We seed true for every model that is NOT an image-generation model,
// matching the discriminator used for compaction eligibility (1760000055). The
// one image model in the catalogue is image-only, so it correctly stays false.
// A future model that does both text and image must set this true explicitly.
// Idempotent and safe to re-run.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{"id":"aimodtxtcmp1","name":"supports_text_completion","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`); err != nil {
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
			if record.GetBool("supports_image_generation") {
				continue
			}
			record.Set("supports_text_completion", true)
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
		collection.Fields.RemoveById("aimodtxtcmp1")
		return app.Save(collection)
	})
}
