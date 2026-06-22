package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Enables the Gemini image model robustly. Migration 1760000047 only flipped a
// model seeded as "gemini-2-5-flash-image", but older dev databases ran an
// earlier Requesty seed that used a "vertex-" prefix
// ("vertex-gemini-2-5-flash-image"). Because seed migrations run once, those
// databases never got the flag. This migration finds the model under either id
// (creating the canonical one only if neither exists) and turns on image
// generation idempotently.
func init() {
	m.Register(func(app core.App) error {
		candidateIDs := []string{
			"gemini-2-5-flash-image",
			"vertex-gemini-2-5-flash-image",
		}

		var record *core.Record
		for _, id := range candidateIDs {
			if found, err := app.FindFirstRecordByData("ai_models", "model_id", id); err == nil {
				record = found
				break
			}
		}

		if record == nil {
			// Neither id exists — create the canonical model if we have a
			// provider to attach it to.
			provider, err := app.FindFirstRecordByData("ai_providers", "provider_id", "requesty")
			if err != nil {
				return nil // no Requesty provider in this environment; nothing to do
			}
			created, err := findOrCreateRecord(app, "ai_models", "model_id", "gemini-2-5-flash-image", map[string]any{
				"provider":                      provider.Id,
				"name":                          "Gemini 2.5 Flash Image",
				"slug":                          "gemini-2-5-flash-image",
				"description":                   "Served through Requesty's EU gateway in Frankfurt.",
				"privacy_tier":                  "eu",
				"hosting_country":               "EU",
				"hosting_region":                "eu",
				"no_retention":                  true,
				"input_context_tokens":          1048576,
				"max_output_tokens":             65535,
				"input_usd_per_million_tokens":  0.3,
				"output_usd_per_million_tokens": 2.5,
			})
			if err != nil {
				return err
			}
			record = created
		}

		record.Set("enabled", true)
		record.Set("whitelisted", true)
		record.Set("supports_image_generation", true)
		record.Set("image_generation_transport", "chat_completions")
		record.Set("provider_model_id", "vertex/gemini-2.5-flash-image@europe-central2")
		return app.Save(record)
	}, func(app core.App) error {
		for _, id := range []string{"gemini-2-5-flash-image", "vertex-gemini-2-5-flash-image"} {
			record, err := app.FindFirstRecordByData("ai_models", "model_id", id)
			if err != nil {
				continue
			}
			record.Set("supports_image_generation", false)
			record.Set("image_generation_transport", "")
			record.Set("whitelisted", false)
			if err := app.Save(record); err != nil {
				return err
			}
		}
		return nil
	})
}
