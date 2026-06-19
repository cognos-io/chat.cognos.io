package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Add per-account login-lockout bookkeeping to users. Both fields are hidden
// from the API (never returned, not settable by clients) and are managed only
// by the EnforceLoginLockout hook:
//
//   - failed_login_attempts: consecutive failed sign-ins, reset on success
//   - locked_until: while in the future, sign-in is blocked for this account
//     regardless of source IP
//
// This complements the per-IP rate limit: an attacker who rotates IPs can
// sidestep the IP limit but not a lock pinned to the target account.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		collection.Fields.Add(&core.NumberField{
			Name:   "failed_login_attempts",
			Hidden: true,
		})
		collection.Fields.Add(&core.DateField{
			Name:   "locked_until",
			Hidden: true,
		})

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		collection.Fields.RemoveByName("failed_login_attempts")
		collection.Fields.RemoveByName("locked_until")

		return app.Save(collection)
	})
}
