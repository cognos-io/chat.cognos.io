package main

import "testing"

func TestConversationImportReceiptsAreLocked(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)
	collection, err := app.FindCollectionByNameOrId("conversation_import_receipts")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_import_receipts) = %v", err)
	}
	if collection.ListRule != nil || collection.ViewRule != nil ||
		collection.CreateRule != nil || collection.UpdateRule != nil ||
		collection.DeleteRule != nil {
		t.Error("conversation_import_receipts rules are not all locked, want nil rules")
	}
	for _, field := range []string{"user", "import_id", "request_digest", "conversation", "message_count"} {
		if collection.Fields.GetByName(field) == nil {
			t.Errorf("conversation_import_receipts field %q missing", field)
		}
	}
}
