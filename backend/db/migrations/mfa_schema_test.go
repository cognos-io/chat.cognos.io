package migrations

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// Sunny path: the MFA migrations add the hidden user bookkeeping fields and
// create the four locked auth collections with their key fields.
func TestMFASchema(t *testing.T) {
	app := bootMigratedApp(t)

	t.Run("users carries hidden MFA fields", func(t *testing.T) {
		c := mustCollection(t, app, "users")
		assertHasFields(t, c,
			"mfa_enabled", "mfa_enrolled_at", "mfa_failed_attempts", "mfa_locked_until",
		)
		for _, name := range []string{"mfa_enabled", "mfa_enrolled_at", "mfa_failed_attempts", "mfa_locked_until"} {
			field := c.Fields.GetByName(name)
			if field != nil && !field.GetHidden() {
				t.Errorf("users.%s must be hidden from the API", name)
			}
		}
	})

	t.Run("user_mfa_totp exists", func(t *testing.T) {
		c := mustCollection(t, app, "user_mfa_totp")
		assertHasFields(t, c,
			"user", "secret_ciphertext", "secret_nonce", "secret_key_id",
			"algorithm", "digits", "period_seconds", "last_accepted_step",
			"verified_at", "disabled_at", "last_used_at", "created", "updated",
		)
	})

	t.Run("mfa_auth_sessions exists", func(t *testing.T) {
		c := mustCollection(t, app, "mfa_auth_sessions")
		assertHasFields(t, c,
			"user", "session_hash", "first_factor", "failed_attempts",
			"expires_at", "consumed_at", "created",
		)
	})

	t.Run("mfa_recovery_codes exists", func(t *testing.T) {
		c := mustCollection(t, app, "mfa_recovery_codes")
		assertHasFields(t, c, "user", "code_hash", "used_at", "created")
	})

	t.Run("mfa_trusted_devices exists", func(t *testing.T) {
		c := mustCollection(t, app, "mfa_trusted_devices")
		assertHasFields(t, c,
			"user", "token_hash", "label", "expires_at", "last_used_at", "revoked_at", "created",
		)
	})

	// Security: MFA collections are pure auth material — unreachable through the
	// generic record API (every rule nil = superuser-only).
	t.Run("MFA collections keep all API rules locked", func(t *testing.T) {
		for _, name := range []string{
			"user_mfa_totp", "mfa_auth_sessions", "mfa_recovery_codes", "mfa_trusted_devices",
		} {
			c := mustCollection(t, app, name)
			if c.ListRule != nil || c.ViewRule != nil || c.CreateRule != nil ||
				c.UpdateRule != nil || c.DeleteRule != nil {
				t.Errorf("collection %q must keep all API rules nil (superuser-only)", name)
			}
		}
	})
}

// Edge: a user may only have one TOTP row — enrolment upserts, so the unique
// index must reject a second row for the same user.
func TestUserMFATOTPUniquePerUser(t *testing.T) {
	app := bootMigratedApp(t)

	users := mustCollection(t, app, "users")
	user := core.NewRecord(users)
	user.Set("email", "totp-unique@example.com")
	user.SetPassword("CorrectHorseBatteryStaple1!")
	if err := app.Save(user); err != nil {
		t.Fatalf("save user: %v", err)
	}

	totp := mustCollection(t, app, "user_mfa_totp")
	first := core.NewRecord(totp)
	first.Set("user", user.Id)
	first.Set("secret_ciphertext", "ct1")
	first.Set("secret_nonce", "n1")
	first.Set("secret_key_id", "k1")
	if err := app.Save(first); err != nil {
		t.Fatalf("first totp row should succeed: %v", err)
	}

	dup := core.NewRecord(totp)
	dup.Set("user", user.Id)
	dup.Set("secret_ciphertext", "ct2")
	dup.Set("secret_nonce", "n2")
	dup.Set("secret_key_id", "k1")
	if err := app.Save(dup); err == nil {
		t.Fatal("expected duplicate user_mfa_totp row to be rejected")
	}
}

// Edge: session and trusted-device hashes are the lookup keys; collisions must
// be impossible.
func TestMFAHashUniqueness(t *testing.T) {
	app := bootMigratedApp(t)

	users := mustCollection(t, app, "users")
	user := core.NewRecord(users)
	user.Set("email", "hash-unique@example.com")
	user.SetPassword("CorrectHorseBatteryStaple1!")
	if err := app.Save(user); err != nil {
		t.Fatalf("save user: %v", err)
	}

	sessions := mustCollection(t, app, "mfa_auth_sessions")
	s1 := core.NewRecord(sessions)
	s1.Set("user", user.Id)
	s1.Set("session_hash", "dup-session-hash")
	s1.Set("expires_at", "2099-01-01 00:00:00.000Z")
	if err := app.Save(s1); err != nil {
		t.Fatalf("first session should succeed: %v", err)
	}
	s2 := core.NewRecord(sessions)
	s2.Set("user", user.Id)
	s2.Set("session_hash", "dup-session-hash")
	s2.Set("expires_at", "2099-01-01 00:00:00.000Z")
	if err := app.Save(s2); err == nil {
		t.Fatal("expected duplicate session_hash to be rejected")
	}
}
