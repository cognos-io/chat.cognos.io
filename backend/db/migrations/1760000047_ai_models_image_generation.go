package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds image-generation capability metadata to ai_models and switches on the
// already-seeded Gemini image model. supports_image_generation is the
// user-facing capability flag; image_generation_transport tells the backend
// which provider API to use (Requesty serves OpenAI gpt-image via the dedicated
// Images API and Google Gemini via chat completions).
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"id": "aimodimggen01",
			"name": "supports_image_generation",
			"type": "bool",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {}
		}`); err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"id": "aimodimgtr01",
			"name": "image_generation_transport",
			"type": "select",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"maxSelect": 1, "values": ["images_api", "chat_completions"]}
		}`); err != nil {
			return err
		}

		if err := app.Save(collection); err != nil {
			return err
		}

		// Switch on the seeded Gemini image model: it generates via chat
		// completions, and we point it at the ZDR/EU region confirmed to work.
		record, err := app.FindFirstRecordByData("ai_models", "model_id", "gemini-2-5-flash-image")
		if err != nil {
			return nil // model not seeded in this environment; nothing to enable
		}
		record.Set("supports_image_generation", true)
		record.Set("image_generation_transport", "chat_completions")
		record.Set("whitelisted", true)
		record.Set("provider_model_id", "vertex/gemini-2.5-flash-image@europe-central2")
		return app.Save(record)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		if record, err := app.FindFirstRecordByData("ai_models", "model_id", "gemini-2-5-flash-image"); err == nil {
			record.Set("supports_image_generation", false)
			record.Set("image_generation_transport", "")
			record.Set("whitelisted", false)
			if err := app.Save(record); err != nil {
				return err
			}
		}

		collection.Fields.RemoveById("aimodimggen01")
		collection.Fields.RemoveById("aimodimgtr01")
		return app.Save(collection)
	})
}
