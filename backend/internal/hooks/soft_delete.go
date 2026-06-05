package hooks

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/forms"
)

func SoftDelete(app core.App) {
	// Helper hook that keeps a record of the deleted data as an alternative to soft deletes
	// Inspiration: https://brandur.org/fragments/deleted-record-insert
	app.OnRecordDeleteRequest().BindFunc(func(e *core.RecordRequestEvent) error {
		const (
			DeletedCollectionName = "deleted"
		)

		// Add other collection names here where you don't want to keep a copy of the deleted record
		excludedCollections := []string{
			DeletedCollectionName,
		}

		// Skip if the record is already deleted or in excluded collections
		if slices.Contains(excludedCollections, e.Record.Collection().Name) {
			return e.Next()
		}

		collection, err := app.FindCollectionByNameOrId(DeletedCollectionName)
		if err != nil {
			return err
		}

		record := core.NewRecord(collection)

		form := forms.NewRecordUpsert(app, record)
		form.Load(map[string]any{
			"collection": e.Record.Collection().Name,
			"record":     e.Record,
		})

		if err := form.Submit(); err != nil {
			return err
		}

		return e.Next()
	})
}
