package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Marks text models eligible for compaction (spec docs/specs/client-side-
// compaction.md §13). eligible_for_compaction is a curated flag that defaults
// false, so without this seed compaction would never run for anyone. We enable
// it for every model that is not an image-generation model; the structured-
// output and cache-hint capabilities stay false because V1 uses the universal
// delimited-text path. Idempotent and safe to re-run.
func init() {
	m.Register(func(app core.App) error {
		records, err := app.FindAllRecords("ai_models")
		if err != nil {
			return err
		}
		for _, record := range records {
			if record.GetBool("supports_image_generation") {
				continue
			}
			record.Set("eligible_for_compaction", true)
			if err := app.Save(record); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		records, err := app.FindAllRecords("ai_models")
		if err != nil {
			return err
		}
		for _, record := range records {
			record.Set("eligible_for_compaction", false)
			if err := app.Save(record); err != nil {
				return err
			}
		}
		return nil
	})
}
