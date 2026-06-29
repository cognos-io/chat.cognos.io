package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
)

// The MFA login interceptor withholds the auth token from enrolled users until
// a second factor is supplied. It must:
//   - leave non-enrolled users completely unaffected (token issued as before);
//   - challenge enrolled users with a distinct mfa_required body, no token;
//   - block even direct hits on PocketBase's auth-with-password route;
//   - waive the challenge for a valid trusted-device token.
//
// The harness rebuilds the router per ApiScenario, so each test seeds state and
// exercises exactly one auth request.

func mfaAuthScenario(app *tests.TestApp, headers map[string]string, expectedStatus int, expectedContent ...string) tests.ApiScenario {
	return tests.ApiScenario{
		Name:   "password auth with mfa",
		Method: http.MethodPost,
		URL:    "/api/collections/users/auth-with-password",
		Body: strings.NewReader(`{
			"identity": "test1@example.com",
			"password": "password-1234"
		}`),
		Headers:               headers,
		ExpectedStatus:        expectedStatus,
		ExpectedContent:       expectedContent,
		DisableTestAppCleanup: true,
		TestAppFactory: func(testing.TB) *tests.TestApp {
			return app
		},
	}
}

func enableMFA(t *testing.T, app *tests.TestApp) *core.Record {
	t.Helper()
	record, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail: %v", err)
	}
	record.Set("mfa_enabled", true)
	record.Set("mfa_enrolled_at", types.NowDateTime())
	if err := app.Save(record); err != nil {
		t.Fatalf("enable mfa: %v", err)
	}
	return record
}

// Sunny path: a user without MFA still gets a token straight away.
func TestMFALoginNonEnrolledUserUnaffected(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	scenario := mfaAuthScenario(app, nil, http.StatusOK, `"token":"`)
	scenario.Test(t)
}

// Core behaviour: an enrolled user's correct password yields mfa_required and a
// session id, NOT a token.
func TestMFALoginEnrolledUserChallenged(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	enableMFA(t, app)

	scenario := mfaAuthScenario(app, nil, http.StatusUnauthorized, "mfa_required", "mfaSessionId")
	scenario.Test(t)
}

// Security: the challenge response must not leak an auth token.
func TestMFALoginChallengeWithholdsToken(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	enableMFA(t, app)

	scenario := mfaAuthScenario(app, nil, http.StatusUnauthorized, "mfaSessionId")
	scenario.NotExpectedContent = []string{`"token":"`}
	scenario.Test(t)
}

// A valid trusted-device token waives the challenge: the user gets a token.
func TestMFALoginTrustedDeviceSkipsChallenge(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	user := enableMFA(t, app)

	store := mfa.NewStore(app)
	rawDevice, err := store.CreateTrustedDevice(user.Id, "test device")
	if err != nil {
		t.Fatalf("create trusted device: %v", err)
	}

	scenario := mfaAuthScenario(app, map[string]string{mfa.MFADeviceHeader: rawDevice}, http.StatusOK, `"token":"`)
	scenario.Test(t)
}

// An unknown / forged device token does not waive the challenge.
func TestMFALoginInvalidTrustedDeviceStillChallenged(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	enableMFA(t, app)

	scenario := mfaAuthScenario(app, map[string]string{mfa.MFADeviceHeader: "not-a-real-device-token"}, http.StatusUnauthorized, "mfa_required")
	scenario.Test(t)
}

// A revoked device token does not waive the challenge.
func TestMFALoginRevokedTrustedDeviceStillChallenged(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	user := enableMFA(t, app)

	store := mfa.NewStore(app)
	rawDevice, err := store.CreateTrustedDevice(user.Id, "test device")
	if err != nil {
		t.Fatalf("create trusted device: %v", err)
	}
	if err := store.RevokeAllTrustedDevices(user.Id); err != nil {
		t.Fatalf("revoke devices: %v", err)
	}

	scenario := mfaAuthScenario(app, map[string]string{mfa.MFADeviceHeader: rawDevice}, http.StatusUnauthorized, "mfa_required")
	scenario.Test(t)
}
