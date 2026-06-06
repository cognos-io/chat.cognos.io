package main

import (
	"testing"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/hooks"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func TestDeletedRecordCleanupDeletesExpiredCopies(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	collection, err := app.FindCollectionByNameOrId("deleted")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(deleted) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Set("collection", "user_preferences")
	record.Set("record", map[string]any{"id": "cleanup-test"})
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(deleted record) error = %v", err)
	}

	oldCreated, err := types.ParseDateTime(time.Now().UTC().Add(-31 * 24 * time.Hour))
	if err != nil {
		t.Fatalf("ParseDateTime() error = %v", err)
	}
	record.SetRaw("created", oldCreated)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(updated deleted record) error = %v", err)
	}

	repo := hooks.NewPocketBaseDeletedRecordRepo(app)
	if err := repo.DeleteCreatedBefore(time.Now().UTC().Add(-30 * 24 * time.Hour)); err != nil {
		t.Fatalf("DeleteCreatedBefore() error = %v", err)
	}

	if _, err := app.FindRecordById("deleted", record.Id); err == nil {
		t.Fatal("FindRecordById(deleted) unexpectedly found cleaned up record")
	}
}
