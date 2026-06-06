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
	record.Set("deleted_at", oldCreated)
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

func TestDeletedRecordCleanupPaginates(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	collection, err := app.FindCollectionByNameOrId("deleted")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(deleted) error = %v", err)
	}

	oldCreated, err := types.ParseDateTime(time.Now().UTC().Add(-31 * 24 * time.Hour))
	if err != nil {
		t.Fatalf("ParseDateTime() error = %v", err)
	}

	for i := range 501 {
		record := core.NewRecord(collection)
		record.Set("collection", "user_preferences")
		record.Set("record", map[string]any{"id": i})
		if err := app.Save(record); err != nil {
			t.Fatalf("Save(expired deleted record %d) error = %v", i, err)
		}

		record.Set("deleted_at", oldCreated)
		if err := app.Save(record); err != nil {
			t.Fatalf("Save(updated expired deleted record %d) error = %v", i, err)
		}
	}

	freshRecord := core.NewRecord(collection)
	freshRecord.Set("collection", "user_preferences")
	freshRecord.Set("deleted_at", types.NowDateTime())
	freshRecord.Set("record", map[string]any{"id": "fresh"})
	if err := app.Save(freshRecord); err != nil {
		t.Fatalf("Save(fresh deleted record) error = %v", err)
	}

	repo := hooks.NewPocketBaseDeletedRecordRepo(app)
	if err := repo.DeleteCreatedBefore(time.Now().UTC().Add(-30 * 24 * time.Hour)); err != nil {
		t.Fatalf("DeleteCreatedBefore() error = %v", err)
	}

	count, err := app.CountRecords("deleted")
	if err != nil {
		t.Fatalf("CountRecords(deleted) error = %v", err)
	}
	if count != 1 {
		t.Fatalf("CountRecords(deleted) = %d, want 1", count)
	}

	if _, err := app.FindRecordById("deleted", freshRecord.Id); err != nil {
		t.Fatalf("FindRecordById(fresh deleted record) error = %v", err)
	}
}
