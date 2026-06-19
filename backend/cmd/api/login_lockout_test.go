package main

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Per-account lockout protects a single account against credential guessing
// even when the attacker rotates source IPs (which sidesteps the IP rate
// limit). After a threshold of consecutive failures the account is locked for
// a cooldown; a successful sign-in clears the counter.
//
// The PocketBase test harness rebuilds the router per ApiScenario, so a single
// app can serve only one scenario. Each test therefore seeds the lockout
// bookkeeping fields directly and exercises exactly one auth request.

func authScenario(app *tests.TestApp, password string, expectedStatus int, expectedContent ...string) tests.ApiScenario {
	return tests.ApiScenario{
		Name:   "auth attempt",
		Method: http.MethodPost,
		URL:    "/api/collections/users/auth-with-password",
		Body: strings.NewReader(`{
			"identity": "test1@example.com",
			"password": "` + password + `"
		}`),
		ExpectedStatus:        expectedStatus,
		ExpectedContent:       expectedContent,
		DisableTestAppCleanup: true,
		TestAppFactory: func(testing.TB) *tests.TestApp {
			return app
		},
	}
}

func seedLockoutState(t *testing.T, app *tests.TestApp, attempts int, lockedUntil types.DateTime) {
	t.Helper()
	record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users) error = %v", err)
	}
	record.Set("failed_login_attempts", attempts)
	record.Set("locked_until", lockedUntil)
	if err := app.Save(record); err != nil {
		t.Fatalf("seed lockout state: %v", err)
	}
}

func TestLoginLockoutRejectsLockedAccount(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	// The account is locked for another 15 minutes — even the CORRECT password
	// must be rejected with a 429 while the lock holds.
	seedLockoutState(t, app, 0, types.NowDateTime().Add(15*time.Minute))

	scenario := authScenario(app, "password-1234", http.StatusTooManyRequests, "locked")
	scenario.Test(t)
}

func TestLoginLockoutLocksAfterThreshold(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	// One failure short of the threshold; the next failed attempt should lock.
	seedLockoutState(t, app, 4, types.DateTime{})

	scenario := authScenario(app, "wrong-password-xyz", http.StatusBadRequest, "Failed to authenticate")
	scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
		record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
		if err != nil {
			t.Fatalf("FindAuthRecordByEmail(users) error = %v", err)
		}
		lockedUntil := record.GetDateTime("locked_until")
		if lockedUntil.IsZero() || !lockedUntil.After(types.NowDateTime()) {
			t.Fatalf("account should be locked after the threshold; locked_until = %v", lockedUntil)
		}
	}
	scenario.Test(t)
}

func TestLoginLockoutResetsOnSuccessfulLogin(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	// A few prior failures, then a success — the counter must be cleared so it
	// does not creep toward the threshold across unrelated sessions.
	seedLockoutState(t, app, 3, types.DateTime{})

	scenario := authScenario(app, "password-1234", http.StatusOK, `"token":"`)
	scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
		record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
		if err != nil {
			t.Fatalf("FindAuthRecordByEmail(users) error = %v", err)
		}
		if got := record.GetInt("failed_login_attempts"); got != 0 {
			t.Fatalf("failed_login_attempts = %d after a successful login, want 0", got)
		}
	}
	scenario.Test(t)
}

func TestLoginLockoutDoesNotBlockNormalLogin(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	// A clean first attempt with the right password must always succeed.
	scenario := authScenario(app, "password-1234", http.StatusOK, `"token":"`)
	scenario.Test(t)
}
