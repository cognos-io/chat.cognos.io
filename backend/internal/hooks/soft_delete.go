package hooks

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/forms"
	"github.com/pocketbase/pocketbase/models"
)

func SoftDelete(app core.App) {
	// Helper hook that keeps a record of the deleted data as an alternative to soft deletes
	// Inspiration: https://brandur.org/fragments/deleted-record-insert
	app.OnRecordBeforeDeleteRequest().Add(func(e *core.RecordDeleteEvent) error {
		const (
			DeletedCollectionName = "deleted"
		)

		// Add other collection names here where you don't want to keep a copy of the deleted record
		excludedCollections := []string{
			DeletedCollectionName,
		}

		// Skip if the record is already deleted or in excluded collections
		if slices.Contains(excludedCollections, e.Collection.Name) {
			return nil
		}

		collection, err := app.Dao().FindCollectionByNameOrId(DeletedCollectionName)
		if err != nil {
			return err
		}

		record := models.NewRecord(collection)

		form := forms.NewRecordUpsert(app, record)
		err = form.LoadData(map[string]any{
			"collection": e.Collection.Name,
			"record":     e.Record,
		})
		if err != nil {
			return err
		}

		return form.Submit()
	})
}
