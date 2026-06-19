package main

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestUsersMinPasswordLengthIs12(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	collection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(users) error = %v", err)
	}

	field, ok := collection.Fields.GetByName("password").(*core.PasswordField)
	if !ok {
		t.Fatal("users.password is not a PasswordField")
	}
	if field.Min != 12 {
		t.Fatalf("users password Min = %d, want 12", field.Min)
	}
}
