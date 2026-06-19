package main

import "testing"

// The users auth-token lasts 30 days so a session (and the split-key vault
// unlock that rides on it) persists without frequent re-login + Account Key
// re-entry.
func TestUsersAuthTokenDurationIs30Days(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	collection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(users) error = %v", err)
	}

	const thirtyDaysSeconds int64 = 2_592_000
	if got := collection.AuthToken.Duration; got != thirtyDaysSeconds {
		t.Fatalf("users AuthToken.Duration = %d, want %d", got, thirtyDaysSeconds)
	}
}
