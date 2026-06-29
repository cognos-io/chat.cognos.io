package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
)

func mfaPost(app *tests.TestApp, url string, body map[string]any, expectedStatus int, expectedContent ...string) tests.ApiScenario {
	raw, _ := json.Marshal(body)
	return tests.ApiScenario{
		Name:                  url,
		Method:                http.MethodPost,
		URL:                   url,
		Body:                  strings.NewReader(string(raw)),
		ExpectedStatus:        expectedStatus,
		ExpectedContent:       expectedContent,
		DisableTestAppCleanup: true,
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
	}
}

// Sunny path: a valid TOTP code against an open session returns a real auth
// token. That it returns a token at all also proves the issued token is NOT
// re-intercepted by the login hook (no infinite MFA loop).
func TestMFACompleteTOTPSuccess(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	userID, secret := enrollVerifiedTOTP(t, app)
	session := openSession(t, app, userID)

	scenario := mfaPost(app, "/api/v1/auth/mfa/totp", map[string]any{
		"mfaSessionId": session,
		"code":         totpCodeNow(t, secret),
	}, http.StatusOK, `"token":"`, `"record":`)
	scenario.Test(t)
}

// Remembering the device returns a trusted-device token in the response meta.
func TestMFACompleteTOTPRemembersDevice(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	userID, secret := enrollVerifiedTOTP(t, app)
	session := openSession(t, app, userID)

	scenario := mfaPost(app, "/api/v1/auth/mfa/totp", map[string]any{
		"mfaSessionId":   session,
		"code":           totpCodeNow(t, secret),
		"rememberDevice": true,
		"deviceLabel":    "MacBook",
	}, http.StatusOK, `"trustedDeviceToken"`)
	scenario.Test(t)
}

// Rainy: a wrong code is rejected with no token.
func TestMFACompleteTOTPWrongCode(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	userID, _ := enrollVerifiedTOTP(t, app)
	session := openSession(t, app, userID)

	scenario := mfaPost(app, "/api/v1/auth/mfa/totp", map[string]any{
		"mfaSessionId": session,
		"code":         "000000",
	}, http.StatusUnauthorized)
	scenario.NotExpectedContent = []string{`"token":"`}
	scenario.Test(t)
}

// Rainy: an unknown session id is rejected.
func TestMFACompleteTOTPUnknownSession(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	_, secret := enrollVerifiedTOTP(t, app)

	scenario := mfaPost(app, "/api/v1/auth/mfa/totp", map[string]any{
		"mfaSessionId": "not-a-real-session",
		"code":         totpCodeNow(t, secret),
	}, http.StatusUnauthorized, "Invalid or expired")
	scenario.Test(t)
}

// Edge: replay of an already-accepted timestep is rejected. We simulate by
// pre-advancing last_accepted_step beyond the current step.
func TestMFACompleteTOTPReplayRejected(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	userID, secret := enrollVerifiedTOTP(t, app)
	session := openSession(t, app, userID)

	// Force last_accepted_step to a far-future value so the current code's step
	// is <= last and must be rejected as replay.
	totp, err := app.FindFirstRecordByData("user_mfa_totp", "user", userID)
	if err != nil {
		t.Fatalf("find totp: %v", err)
	}
	totp.Set("last_accepted_step", 1<<60)
	if err := app.Save(totp); err != nil {
		t.Fatalf("save totp: %v", err)
	}

	scenario := mfaPost(app, "/api/v1/auth/mfa/totp", map[string]any{
		"mfaSessionId": session,
		"code":         totpCodeNow(t, secret),
	}, http.StatusUnauthorized)
	scenario.NotExpectedContent = []string{`"token":"`}
	scenario.Test(t)
}

// Edge: while the account is in an MFA cooldown, even a valid code is rejected
// with 429.
func TestMFACompleteTOTPRejectedWhileLocked(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	userID, secret := enrollVerifiedTOTP(t, app)
	session := openSession(t, app, userID)

	user, err := app.FindRecordById("users", userID)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}
	user.Set("mfa_locked_until", futureDateTime())
	if err := app.Save(user); err != nil {
		t.Fatalf("lock user: %v", err)
	}

	scenario := mfaPost(app, "/api/v1/auth/mfa/totp", map[string]any{
		"mfaSessionId": session,
		"code":         totpCodeNow(t, secret),
	}, http.StatusTooManyRequests, "Too many incorrect codes")
	scenario.NotExpectedContent = []string{`"token":"`}
	scenario.Test(t)
}

// Sunny: a valid recovery code completes login.
func TestMFACompleteRecoverySuccess(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	userID, _ := enrollVerifiedTOTP(t, app)
	codes := seedRecoveryCodes(t, app, userID)
	session := openSession(t, app, userID)

	scenario := mfaPost(app, "/api/v1/auth/mfa/recovery", map[string]any{
		"mfaSessionId": session,
		"code":         codes[0],
	}, http.StatusOK, `"token":"`)
	scenario.Test(t)
}

// Edge: a recovery code cannot be reused — a second open session with the same
// (now-used) code is rejected.
func TestMFACompleteRecoveryNoReuse(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	userID, _ := enrollVerifiedTOTP(t, app)
	codes := seedRecoveryCodes(t, app, userID)

	// Model a prior successful use: consume the first code directly via the store.
	store := mfa.NewStore(app)
	rec, err := store.FindUnusedRecoveryCode(userID, mfa.NormalizeRecoveryCode(codes[0]))
	if err != nil {
		t.Fatalf("find recovery code: %v", err)
	}
	if err := store.MarkRecoveryCodeUsed(rec); err != nil {
		t.Fatalf("mark used: %v", err)
	}

	session := openSession(t, app, userID)
	scenario := mfaPost(app, "/api/v1/auth/mfa/recovery", map[string]any{
		"mfaSessionId": session,
		"code":         codes[0],
	}, http.StatusUnauthorized)
	scenario.NotExpectedContent = []string{`"token":"`}
	scenario.Test(t)
}
