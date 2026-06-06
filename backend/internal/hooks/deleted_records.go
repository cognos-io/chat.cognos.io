package hooks

import (
	"slices"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const deletedCollectionName = "deleted"

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
	records, err := r.app.FindRecordsByFilter(
		r.collection.Name,
		"",
		"",
		500,
		0,
	)
	if err != nil {
		return err
	}

	for _, record := range records {
		if !record.GetDateTime("created").Time().Before(cutoff.UTC()) {
			continue
		}

		if err := r.app.Delete(record); err != nil {
			return err
		}
	}

	return nil
}
