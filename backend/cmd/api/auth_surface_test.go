package main

import (
	"slices"
	"testing"
)

func TestUsersAuthSurfaceIsHardened(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	collection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(users) error = %v", err)
	}

	if !collection.PasswordAuth.Enabled {
		t.Fatal("users.PasswordAuth.Enabled = false, want true")
	}
	if got, want := collection.PasswordAuth.IdentityFields, []string{"email"}; !slices.Equal(got, want) {
		t.Fatalf("users.PasswordAuth.IdentityFields = %v, want %v", got, want)
	}
	if collection.OAuth2.Enabled {
		t.Fatal("users.OAuth2.Enabled = true, want false")
	}
	if len(collection.OAuth2.Providers) != 0 {
		t.Fatalf("users.OAuth2.Providers = %v, want empty", collection.OAuth2.Providers)
	}
}
