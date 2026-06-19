package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Extend the auth-token lifetime to 30 days. A signed-in session — and the
// split-key vault unlock that rides on it (see docs/security-model.md §8) —
// persists for the token's life; the token auto-refreshes while the app is
// open, so in practice this means "stay signed in (and unlocked) for up to 30
// days of inactivity" instead of PocketBase's 5-day default. This is what stops
// frequent re-login + Account Key re-entry. The Account Key itself is never
// stored; only the revocable split-key session is.
const usersAuthTokenDuration30Days int64 = 2_592_000

// PocketBase's default for an auth collection.
const usersAuthTokenDurationDefault int64 = 432_000

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		collection.AuthToken.Duration = usersAuthTokenDuration30Days

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		collection.AuthToken.Duration = usersAuthTokenDurationDefault

		return app.Save(collection)
	})
}
