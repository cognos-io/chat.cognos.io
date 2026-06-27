package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// supports_file_input marks models that accept native file (PDF) input as a
// document content block, so the client sends the raw PDF instead of
// client-extracted text (better quality on scanned/tabular PDFs). Requesty does
// not expose this capability, so it is CURATED here and should be reviewed when
// the model catalogue changes. Conservative list: providers with established
// native PDF support (Anthropic Claude, Google Gemini, OpenAI GPT-4o/5/o-series).
func init() {
	fileInputModelIDs := []string{
		"claude-opus-4-8",
		"claude-sonnet-4-6",
		"claude-haiku-4-5",
		"gemini-2-5-pro",
		"gemini-3-5-flash",
		"gemini-3-1-flash-lite",
		"gpt-4o-mini",
		"gpt-5-5",
		"gpt-5-mini",
		"gpt-5-nano",
		"o4-mini",
		"responses-gpt-5-5",
		"responses-gpt-4-1-mini",
		"responses-gpt-4-1-nano",
	}

	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{"id":"aimodfilein01","name":"supports_file_input","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`); err != nil {
			return err
		}
		if err := app.Save(collection); err != nil {
			return err
		}

		for _, modelID := range fileInputModelIDs {
			record, err := app.FindFirstRecordByFilter(
				"ai_models", "model_id={:m}", dbx.Params{"m": modelID},
			)
			if err != nil {
				continue // model not seeded in this environment — skip
			}
			record.Set("supports_file_input", true)
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
		collection.Fields.RemoveById("aimodfilein01")
		return app.Save(collection)
	})
}
