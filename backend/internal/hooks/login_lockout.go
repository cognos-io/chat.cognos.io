package hooks

import (
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	// maxFailedLoginAttempts is the number of consecutive failed sign-ins that
	// locks an account.
	maxFailedLoginAttempts = 5

	// loginLockoutDuration is how long an account stays locked after the
	// threshold is reached.
	loginLockoutDuration = 15 * time.Minute

	lockedMessage = "Account temporarily locked due to too many failed sign-in attempts. Please try again later."
)

// EnforceLoginLockout adds per-account brute-force protection on top of the
// per-IP rate limit. Failures are counted on the user record; once the
// threshold is hit the account is locked for a cooldown, during which even the
// correct password is rejected. A successful sign-in clears the counter.
//
// The fields it reads/writes (failed_login_attempts, locked_until) are hidden
// and never exposed to clients (see the matching migration).
func EnforceLoginLockout(app core.App) {
	app.OnRecordAuthWithPasswordRequest("users").BindFunc(func(e *core.RecordAuthWithPasswordRequestEvent) error {
		record := e.Record

		// Unknown identity: nothing to track, and we must not reveal whether the
		// account exists. Let PocketBase return its normal auth failure.
		if record == nil {
			return e.Next()
		}

		// Already locked? Reject before checking the password so a correct guess
		// during the cooldown still fails.
		if lockedUntil := record.GetDateTime("locked_until"); !lockedUntil.IsZero() &&
			lockedUntil.After(types.NowDateTime()) {
			return apis.NewTooManyRequestsError(lockedMessage, nil)
		}

		authErr := e.Next()

		if authErr != nil {
			// Failed attempt: increment and lock once the threshold is reached.
			attempts := record.GetInt("failed_login_attempts") + 1
			record.Set("failed_login_attempts", attempts)
			if attempts >= maxFailedLoginAttempts {
				record.Set("locked_until", types.NowDateTime().Add(loginLockoutDuration))
				record.Set("failed_login_attempts", 0)
			}
			if saveErr := app.Save(record); saveErr != nil {
				app.Logger().Error("login lockout: failed to record attempt", "error", saveErr)
			}
			return authErr
		}

		// Success: clear any accumulated failure state.
		if record.GetInt("failed_login_attempts") > 0 || !record.GetDateTime("locked_until").IsZero() {
			record.Set("failed_login_attempts", 0)
			record.Set("locked_until", types.DateTime{})
			if saveErr := app.Save(record); saveErr != nil {
				app.Logger().Error("login lockout: failed to clear attempts", "error", saveErr)
			}
		}
		return nil
	})
}
