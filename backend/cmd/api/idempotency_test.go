package main

import "testing"

func TestIdempotencyCollectionIsRemoved(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	if _, err := app.FindCollectionByNameOrId("idempotency"); err == nil {
		t.Fatal("FindCollectionByNameOrId(idempotency) error = nil, want missing collection")
	}
}
