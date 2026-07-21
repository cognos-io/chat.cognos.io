package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Add server-managed MFA bookkeeping to users. Every field is hidden from the
// API (never returned, not settable by clients) and is written only by the
// first-party MFA hooks/handlers. See docs/business_processes/mfa-login.md.
//
//   - mfa_enabled: authoritative, denormalized flag the login interceptor reads
//     on the already-loaded auth record (no extra query on the hot path). Always
//     written in the same transaction as the user_mfa_totp row state.
//   - mfa_enrolled_at: when MFA was last confirmed (audit/UX only).
//   - mfa_failed_attempts / mfa_locked_until: a second-factor brute-force throttle
//     mirroring the password lockout (failed_login_attempts / locked_until). A
//     6-digit code is far more guessable than a 12-char password, so the second
//     factor needs its own cooldown, not just per-request rate limits.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		collection.Fields.Add(&core.BoolField{
			Name:   "mfa_enabled",
			Hidden: true,
		})
		collection.Fields.Add(&core.DateField{
			Name:   "mfa_enrolled_at",
			Hidden: true,
		})
		collection.Fields.Add(&core.NumberField{
			Name:   "mfa_failed_attempts",
			Hidden: true,
		})
		collection.Fields.Add(&core.DateField{
			Name:   "mfa_locked_until",
			Hidden: true,
		})

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		collection.Fields.RemoveByName("mfa_enabled")
		collection.Fields.RemoveByName("mfa_enrolled_at")
		collection.Fields.RemoveByName("mfa_failed_attempts")
		collection.Fields.RemoveByName("mfa_locked_until")

		return app.Save(collection)
	})
}
