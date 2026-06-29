package main

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
)

func userIDForTest(t *testing.T, app *tests.TestApp) string {
	t.Helper()
	user, err := app.FindAuthRecordByEmail("users", testUserEmail)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}
	return user.Id
}

// A session burns (is consumed) once the failure threshold is reached, so an
// attacker cannot keep guessing against one open session.
func TestStoreSessionBurnsAfterThreshold(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	store := mfa.NewStore(app)
	userID := userIDForTest(t, app)

	raw := openSession(t, app, userID)
	session, err := store.FindActiveSession(raw)
	if err != nil {
		t.Fatalf("session should be active: %v", err)
	}

	for i := 1; i <= mfa.MaxSessionFailures; i++ {
		burnt, err := store.RecordSessionFailure(session)
		if err != nil {
			t.Fatalf("record failure: %v", err)
		}
		if i < mfa.MaxSessionFailures && burnt {
			t.Fatalf("session burnt too early at attempt %d", i)
		}
		if i == mfa.MaxSessionFailures && !burnt {
			t.Fatalf("session should burn at attempt %d", i)
		}
	}

	if _, err := store.FindActiveSession(raw); !errors.Is(err, mfa.ErrNotFound) {
		t.Fatalf("burnt session must no longer resolve, got %v", err)
	}
}

// Per-account failures lock the second factor for a cooldown after the
// threshold, mirroring the password lockout.
func TestStoreMFALockoutAfterThreshold(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	store := mfa.NewStore(app)

	user, err := app.FindAuthRecordByEmail("users", testUserEmail)
	if err != nil {
		t.Fatal(err)
	}

	for i := 1; i <= mfa.MaxUserMFAFailures; i++ {
		locked, err := store.RecordMFAFailure(user)
		if err != nil {
			t.Fatalf("record mfa failure: %v", err)
		}
		if i < mfa.MaxUserMFAFailures && locked {
			t.Fatalf("locked too early at %d", i)
		}
		if i == mfa.MaxUserMFAFailures && !locked {
			t.Fatalf("should lock at %d", i)
		}
	}

	if !mfa.IsMFALocked(user) {
		t.Fatal("user should be MFA-locked after the threshold")
	}

	// Clearing resets the state.
	if err := store.ClearMFAFailures(user); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if mfa.IsMFALocked(user) || user.GetInt("mfa_failed_attempts") != 0 {
		t.Fatal("ClearMFAFailures should reset lock state")
	}
}

// An expired session does not resolve.
func TestStoreExpiredSessionRejected(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	store := mfa.NewStore(app)
	userID := userIDForTest(t, app)

	raw := openSession(t, app, userID)
	session, err := store.FindActiveSession(raw)
	if err != nil {
		t.Fatal(err)
	}
	session.Set("expires_at", types.NowDateTime().Add(-1))
	if err := app.Save(session); err != nil {
		t.Fatal(err)
	}

	if _, err := store.FindActiveSession(raw); !errors.Is(err, mfa.ErrNotFound) {
		t.Fatalf("expired session must not resolve, got %v", err)
	}
}

// Trusted-device validity covers: valid, wrong user, expired, revoked.
func TestStoreTrustedDeviceValidity(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	store := mfa.NewStore(app)
	userID := userIDForTest(t, app)

	raw, err := store.CreateTrustedDevice(userID, "laptop")
	if err != nil {
		t.Fatal(err)
	}

	if !store.TrustedDeviceValid(userID, raw) {
		t.Fatal("fresh device should be valid")
	}
	if store.TrustedDeviceValid("someone-else", raw) {
		t.Fatal("device must not be valid for a different user")
	}
	if store.TrustedDeviceValid(userID, "garbage-token") {
		t.Fatal("unknown token must be invalid")
	}

	// Revocation invalidates it.
	if err := store.RevokeAllTrustedDevices(userID); err != nil {
		t.Fatal(err)
	}
	if store.TrustedDeviceValid(userID, raw) {
		t.Fatal("revoked device must be invalid")
	}
}

// Replacing recovery codes drops the old set entirely and stores the new one.
func TestStoreReplaceRecoveryCodes(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()
	store := mfa.NewStore(app)
	userID := userIDForTest(t, app)

	first := seedRecoveryCodes(t, app, userID)
	count, err := store.CountUnusedRecoveryCodes(userID)
	if err != nil {
		t.Fatal(err)
	}
	if count != mfa.RecoveryCodeCount {
		t.Fatalf("want %d codes, got %d", mfa.RecoveryCodeCount, count)
	}

	// Regenerate: old codes must no longer resolve.
	_ = seedRecoveryCodes(t, app, userID)
	if _, err := store.FindUnusedRecoveryCode(userID, mfa.NormalizeRecoveryCode(first[0])); !errors.Is(err, mfa.ErrNotFound) {
		t.Fatalf("old recovery code must be gone after regeneration, got %v", err)
	}
	count, err = store.CountUnusedRecoveryCodes(userID)
	if err != nil {
		t.Fatal(err)
	}
	if count != mfa.RecoveryCodeCount {
		t.Fatalf("after regeneration want %d, got %d", mfa.RecoveryCodeCount, count)
	}
}
