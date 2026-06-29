package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
)

const testUserPassword = "password-1234"

func authedMFAScenario(app *tests.TestApp, method, url string, body map[string]any, expectedStatus int, expectedContent ...string) tests.ApiScenario {
	raw, _ := json.Marshal(body)
	return tests.ApiScenario{
		Name:                  method + " " + url,
		Method:                method,
		URL:                   url,
		Body:                  strings.NewReader(string(raw)),
		ExpectedStatus:        expectedStatus,
		ExpectedContent:       expectedContent,
		DisableTestAppCleanup: true,
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		BeforeTestFunc:        withRecordAuth("users", testUserEmail),
	}
}

// Enrolment requires the current password and returns a secret + provisioning
// URI, but does NOT yet enable MFA.
func TestMFAEnrolRequiresPassword(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	good := authedMFAScenario(app, http.MethodPost, "/api/v1/mfa/totp/enrol",
		map[string]any{"password": testUserPassword},
		http.StatusOK, `"secret":`, `"otpauthUrl":`)
	good.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
		user, _ := app.FindAuthRecordByEmail("users", testUserEmail)
		if user.GetBool("mfa_enabled") {
			t.Fatal("enrolment must not enable MFA before confirmation")
		}
	}
	good.Test(t)
}

func TestMFAEnrolRejectsWrongPassword(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	scenario := authedMFAScenario(app, http.MethodPost, "/api/v1/mfa/totp/enrol",
		map[string]any{"password": "wrong-password"},
		http.StatusBadRequest, "Incorrect password")
	scenario.Test(t)
}

// Confirming with a valid first code enables MFA and returns recovery codes once.
func TestMFAConfirmEnablesAndReturnsRecoveryCodes(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	_, secret := enrollPendingTOTP(t, app)

	scenario := authedMFAScenario(app, http.MethodPost, "/api/v1/mfa/totp/confirm",
		map[string]any{"code": totpCodeNow(t, secret)},
		http.StatusOK, `"recoveryCodes":`)
	scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
		user, _ := app.FindAuthRecordByEmail("users", testUserEmail)
		if !user.GetBool("mfa_enabled") {
			t.Fatal("MFA should be enabled after confirmation")
		}
		count, _ := mfa.NewStore(app).CountUnusedRecoveryCodes(user.Id)
		if count != mfa.RecoveryCodeCount {
			t.Fatalf("want %d recovery codes after confirm, got %d", mfa.RecoveryCodeCount, count)
		}
	}
	scenario.Test(t)
}

func TestMFAConfirmRejectsWrongCode(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	enrollPendingTOTP(t, app)

	scenario := authedMFAScenario(app, http.MethodPost, "/api/v1/mfa/totp/confirm",
		map[string]any{"code": "000000"},
		http.StatusBadRequest, "Incorrect code")
	scenario.Test(t)
}

// Disable needs BOTH password and a current code; success clears MFA and
// revokes trusted devices.
func TestMFADisableRequiresPasswordAndCode(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	userID, secret := enrollVerifiedTOTP(t, app)
	store := mfa.NewStore(app)
	rawDevice, err := store.CreateTrustedDevice(userID, "laptop")
	if err != nil {
		t.Fatal(err)
	}

	scenario := authedMFAScenario(app, http.MethodPost, "/api/v1/mfa/totp/disable",
		map[string]any{"password": testUserPassword, "code": totpCodeNow(t, secret)},
		http.StatusOK, `"enabled":false`)
	scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
		user, _ := app.FindAuthRecordByEmail("users", testUserEmail)
		if user.GetBool("mfa_enabled") {
			t.Fatal("MFA should be disabled")
		}
		if store.TrustedDeviceValid(userID, rawDevice) {
			t.Fatal("disabling MFA must revoke trusted devices")
		}
	}
	scenario.Test(t)
}

func TestMFADisableRejectsWrongCode(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	enrollVerifiedTOTP(t, app)

	scenario := authedMFAScenario(app, http.MethodPost, "/api/v1/mfa/totp/disable",
		map[string]any{"password": testUserPassword, "code": "000000"},
		http.StatusBadRequest, "Incorrect code")
	scenario.Test(t)
}

// Regenerating recovery codes verifies a current code, returns a fresh set, and
// revokes trusted devices.
func TestMFARegenerateRecoveryCodes(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	userID, secret := enrollVerifiedTOTP(t, app)
	oldCodes := seedRecoveryCodes(t, app, userID)
	store := mfa.NewStore(app)
	rawDevice, _ := store.CreateTrustedDevice(userID, "laptop")

	scenario := authedMFAScenario(app, http.MethodPost, "/api/v1/mfa/recovery-codes",
		map[string]any{"code": totpCodeNow(t, secret)},
		http.StatusOK, `"recoveryCodes":`)
	scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
		if _, err := store.FindUnusedRecoveryCode(userID, mfa.NormalizeRecoveryCode(oldCodes[0])); err == nil {
			t.Fatal("old recovery codes must be invalidated on regeneration")
		}
		if store.TrustedDeviceValid(userID, rawDevice) {
			t.Fatal("regeneration must revoke trusted devices")
		}
	}
	scenario.Test(t)
}

// Status reflects enabled state and remaining recovery codes.
func TestMFAStatus(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	userID, _ := enrollVerifiedTOTP(t, app)
	seedRecoveryCodes(t, app, userID)

	scenario := authedMFAScenario(app, http.MethodGet, "/api/v1/mfa", nil,
		http.StatusOK, `"enabled":true`, `"recoveryCodesRemaining":10`)
	scenario.Test(t)
}

// Trusted devices can be listed and individually revoked by their owner.
func TestMFAListAndRevokeTrustedDevice(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	userID, _ := enrollVerifiedTOTP(t, app)
	store := mfa.NewStore(app)
	if _, err := store.CreateTrustedDevice(userID, "laptop"); err != nil {
		t.Fatal(err)
	}

	devices, err := store.ListActiveTrustedDevices(userID)
	if err != nil || len(devices) != 1 {
		t.Fatalf("expected one active device, got %d (err %v)", len(devices), err)
	}
	deviceID := devices[0].Id

	scenario := authedMFAScenario(app, http.MethodDelete, "/api/v1/mfa/trusted-devices/"+deviceID, nil,
		http.StatusNoContent)
	scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
		remaining, _ := store.ListActiveTrustedDevices(userID)
		if len(remaining) != 0 {
			t.Fatalf("device should be revoked, %d remain", len(remaining))
		}
	}
	scenario.Test(t)
}

// A user cannot revoke another user's device.
func TestMFARevokeForeignDeviceForbidden(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	enrollVerifiedTOTP(t, app)

	// A device owned by a different seed user.
	other, err := app.FindAuthRecordByEmail("users", "test2@example.com")
	if err != nil {
		t.Skipf("no second seed user available: %v", err)
	}
	store := mfa.NewStore(app)
	if _, err := store.CreateTrustedDevice(other.Id, "their-laptop"); err != nil {
		t.Fatal(err)
	}
	devices, _ := store.ListActiveTrustedDevices(other.Id)
	var foreignID string
	if len(devices) > 0 {
		foreignID = devices[0].Id
	}

	scenario := authedMFAScenario(app, http.MethodDelete, "/api/v1/mfa/trusted-devices/"+foreignID, nil,
		http.StatusNotFound, "not found")
	scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
		// The foreign device must remain active.
		remaining, _ := store.ListActiveTrustedDevices(other.Id)
		if len(remaining) != 1 {
			t.Fatal("foreign device must not be revoked by another user")
		}
	}
	scenario.Test(t)
}
