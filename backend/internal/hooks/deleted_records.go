package hooks

import (
	"slices"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	deletedCollectionName         = "deleted"
	deletedRecordCleanupBatchSize = 500
)

var softDeleteExcludedCollections = []string{
	deletedCollectionName,
	"conversation_public_keys",
	"conversation_secret_keys",
	"user_key_pairs",
}

func ShouldCopyDeletedRecord(collectionName string) bool {
	return !slices.Contains(softDeleteExcludedCollections, collectionName)
}

type DeletedRecordRepo interface {
	DeleteCreatedBefore(cutoff time.Time) error
}

type PocketBaseDeletedRecordRepo struct {
	app        core.App
	collection *core.Collection
}

func NewPocketBaseDeletedRecordRepo(app core.App) *PocketBaseDeletedRecordRepo {
	collection, err := app.FindCollectionByNameOrId(deletedCollectionName)
	if err != nil {
		panic(err)
	}

	return &PocketBaseDeletedRecordRepo{
		app:        app,
		collection: collection,
	}
}

func (r *PocketBaseDeletedRecordRepo) DeleteCreatedBefore(cutoff time.Time) error {
	cutoff = cutoff.UTC()

	for {
		records, err := r.app.FindRecordsByFilter(
			r.collection.Name,
			"deleted_at != '' && deleted_at < {:cutoff}",
			"",
			deletedRecordCleanupBatchSize,
			0,
			dbx.Params{"cutoff": cutoff},
		)
		if err != nil {
			return err
		}

		if len(records) == 0 {
			return nil
		}

		for _, record := range records {
			if err := r.app.Delete(record); err != nil {
				return err
			}
		}

		if len(records) < deletedRecordCleanupBatchSize {
			return nil
		}
	}
}
