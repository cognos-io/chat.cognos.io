package mfa

import (
	"database/sql"
	"errors"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Collection names. Centralised so handlers/hooks never hardcode strings.
const (
	collTOTP           = "user_mfa_totp"
	collAuthSessions   = "mfa_auth_sessions"
	collRecoveryCodes  = "mfa_recovery_codes"
	collTrustedDevices = "mfa_trusted_devices"

	// UsersCollection is the PocketBase auth collection MFA hangs off.
	UsersCollection = "users"
)

// ErrNotFound is returned when a looked-up MFA record does not exist (or is no
// longer valid). Callers translate it to an auth failure without leaking which
// part was wrong.
var ErrNotFound = errors.New("mfa: record not found")

// Store is the PocketBase-backed persistence layer for MFA material. It is the
// only place that touches the locked MFA collections.
type Store struct {
	app core.App
}

// NewStore returns a Store bound to the given app.
func NewStore(app core.App) *Store { return &Store{app: app} }

func isNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}

// --- MFA auth sessions -----------------------------------------------------

// CreateAuthSession mints a single-use session proving the password factor
// passed. It stores only the hash and returns the raw token to hand to the
// client.
func (s *Store) CreateAuthSession(userID string) (rawToken string, err error) {
	collection, err := s.app.FindCollectionByNameOrId(collAuthSessions)
	if err != nil {
		return "", err
	}

	rawToken = NewSessionToken()
	record := core.NewRecord(collection)
	record.Set("user", userID)
	record.Set("session_hash", Hash(rawToken))
	record.Set("first_factor", "password")
	record.Set("failed_attempts", 0)
	record.Set("expires_at", types.NowDateTime().Add(AuthSessionTTL))

	if err := s.app.Save(record); err != nil {
		return "", err
	}
	return rawToken, nil
}

// FindActiveSession resolves a raw session token to its record, requiring that
// it exists, is unconsumed, and is unexpired. Returns ErrNotFound otherwise.
func (s *Store) FindActiveSession(rawToken string) (*core.Record, error) {
	if rawToken == "" {
		return nil, ErrNotFound
	}
	record, err := s.app.FindFirstRecordByData(collAuthSessions, "session_hash", Hash(rawToken))
	if err != nil {
		if isNoRows(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if !record.GetDateTime("consumed_at").IsZero() {
		return nil, ErrNotFound
	}
	if expires := record.GetDateTime("expires_at"); expires.IsZero() || expires.Before(types.NowDateTime()) {
		return nil, ErrNotFound
	}
	return record, nil
}

// ConsumeSession marks a session used so it can never be replayed.
func (s *Store) ConsumeSession(record *core.Record) error {
	record.Set("consumed_at", types.NowDateTime())
	return s.app.Save(record)
}

// RecordSessionFailure increments the session's failure counter and consumes it
// once MaxSessionFailures is reached. Returns whether the session is now burnt.
func (s *Store) RecordSessionFailure(record *core.Record) (burnt bool, err error) {
	attempts := record.GetInt("failed_attempts") + 1
	record.Set("failed_attempts", attempts)
	if attempts >= MaxSessionFailures {
		record.Set("consumed_at", types.NowDateTime())
		burnt = true
	}
	if err := s.app.Save(record); err != nil {
		return false, err
	}
	return burnt, nil
}

// --- TOTP credential -------------------------------------------------------

// GetTOTP returns the user's TOTP row, or ErrNotFound.
func (s *Store) GetTOTP(userID string) (*core.Record, error) {
	record, err := s.app.FindFirstRecordByData(collTOTP, "user", userID)
	if err != nil {
		if isNoRows(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return record, nil
}

// UpsertEnrolment creates or replaces the user's (unverified) TOTP row with a
// freshly sealed seed. Enrolment is not yet active — mfa_enabled stays false
// until ConfirmEnrolment.
func (s *Store) UpsertEnrolment(userID, ciphertext, nonce, keyID string) (*core.Record, error) {
	record, err := s.GetTOTP(userID)
	if errors.Is(err, ErrNotFound) {
		collection, cErr := s.app.FindCollectionByNameOrId(collTOTP)
		if cErr != nil {
			return nil, cErr
		}
		record = core.NewRecord(collection)
		record.Set("user", userID)
	} else if err != nil {
		return nil, err
	}

	record.Set("secret_ciphertext", ciphertext)
	record.Set("secret_nonce", nonce)
	record.Set("secret_key_id", keyID)
	record.Set("algorithm", DefaultAlgorithm)
	record.Set("digits", DefaultDigits)
	record.Set("period_seconds", DefaultPeriod)
	record.Set("last_accepted_step", 0)
	record.Set("verified_at", types.DateTime{})
	record.Set("disabled_at", types.DateTime{})

	if err := s.app.Save(record); err != nil {
		return nil, err
	}
	return record, nil
}

// TOTPVerified reports whether a TOTP row is an active, confirmed credential.
func TOTPVerified(record *core.Record) bool {
	return record != nil &&
		!record.GetDateTime("verified_at").IsZero() &&
		record.GetDateTime("disabled_at").IsZero()
}

// MarkTOTPVerified activates a freshly-confirmed credential.
func (s *Store) MarkTOTPVerified(record *core.Record) error {
	record.Set("verified_at", types.NowDateTime())
	record.Set("disabled_at", types.DateTime{})
	return s.app.Save(record)
}

// ResealTOTPSecret persists ciphertext re-sealed under a new encryption key.
func (s *Store) ResealTOTPSecret(record *core.Record, ciphertext, nonce, keyID string) error {
	record.Set("secret_ciphertext", ciphertext)
	record.Set("secret_nonce", nonce)
	record.Set("secret_key_id", keyID)
	return s.app.Save(record)
}

// RecordTOTPUse advances replay protection (last_accepted_step) and stamps
// last_used_at after a successful verification.
func (s *Store) RecordTOTPUse(record *core.Record, step uint64) error {
	record.Set("last_accepted_step", step)
	record.Set("last_used_at", types.NowDateTime())
	return s.app.Save(record)
}

// DisableTOTP marks the credential disabled (kept for audit; mfa_enabled on the
// user is the authoritative live flag).
func (s *Store) DisableTOTP(record *core.Record) error {
	record.Set("disabled_at", types.NowDateTime())
	record.Set("verified_at", types.DateTime{})
	return s.app.Save(record)
}

// --- Recovery codes --------------------------------------------------------

// ReplaceRecoveryCodes deletes any existing codes for the user and stores the
// new hashes. Used at enrolment and on regeneration.
func (s *Store) ReplaceRecoveryCodes(userID string, hashes []string) error {
	existing, err := s.app.FindAllRecords(collRecoveryCodes, dbx.HashExp{"user": userID})
	if err != nil {
		return err
	}
	for _, record := range existing {
		if err := s.app.Delete(record); err != nil {
			return err
		}
	}

	collection, err := s.app.FindCollectionByNameOrId(collRecoveryCodes)
	if err != nil {
		return err
	}
	for _, hash := range hashes {
		record := core.NewRecord(collection)
		record.Set("user", userID)
		record.Set("code_hash", hash)
		if err := s.app.Save(record); err != nil {
			return err
		}
	}
	return nil
}

// FindUnusedRecoveryCode resolves a normalised recovery code to its unused row
// for the given user, or ErrNotFound.
func (s *Store) FindUnusedRecoveryCode(userID, normalizedCode string) (*core.Record, error) {
	if normalizedCode == "" {
		return nil, ErrNotFound
	}
	record, err := s.app.FindFirstRecordByData(collRecoveryCodes, "code_hash", Hash(normalizedCode))
	if err != nil {
		if isNoRows(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if record.GetString("user") != userID {
		return nil, ErrNotFound
	}
	if !record.GetDateTime("used_at").IsZero() {
		return nil, ErrNotFound
	}
	return record, nil
}

// MarkRecoveryCodeUsed consumes a recovery code so it can never be reused.
func (s *Store) MarkRecoveryCodeUsed(record *core.Record) error {
	record.Set("used_at", types.NowDateTime())
	return s.app.Save(record)
}

// CountUnusedRecoveryCodes reports how many recovery codes remain, for the
// status endpoint and "regenerate" nudges.
func (s *Store) CountUnusedRecoveryCodes(userID string) (int, error) {
	records, err := s.app.FindAllRecords(collRecoveryCodes, dbx.HashExp{"user": userID})
	if err != nil {
		return 0, err
	}
	count := 0
	for _, record := range records {
		if record.GetDateTime("used_at").IsZero() {
			count++
		}
	}
	return count, nil
}

// --- Trusted devices -------------------------------------------------------

// CreateTrustedDevice stores a hashed "remember this device" token and returns
// the raw token for the client.
func (s *Store) CreateTrustedDevice(userID, label string) (rawToken string, err error) {
	collection, err := s.app.FindCollectionByNameOrId(collTrustedDevices)
	if err != nil {
		return "", err
	}
	rawToken = NewDeviceToken()
	record := core.NewRecord(collection)
	record.Set("user", userID)
	record.Set("token_hash", Hash(rawToken))
	record.Set("label", label)
	record.Set("expires_at", types.NowDateTime().Add(TrustedDeviceTTL))
	if err := s.app.Save(record); err != nil {
		return "", err
	}
	return rawToken, nil
}

// TrustedDeviceValid reports whether a raw device token is currently a valid
// trust for the given user (exists, matches user, not revoked, not expired).
// On success it bumps last_used_at.
func (s *Store) TrustedDeviceValid(userID, rawToken string) bool {
	if rawToken == "" {
		return false
	}
	record, err := s.app.FindFirstRecordByData(collTrustedDevices, "token_hash", Hash(rawToken))
	if err != nil {
		return false
	}
	if record.GetString("user") != userID {
		return false
	}
	if !record.GetDateTime("revoked_at").IsZero() {
		return false
	}
	if expires := record.GetDateTime("expires_at"); expires.IsZero() || expires.Before(types.NowDateTime()) {
		return false
	}

	record.Set("last_used_at", types.NowDateTime())
	if err := s.app.Save(record); err != nil {
		// A failed bookkeeping save must not deny a legitimate device.
		s.app.Logger().Warn("mfa: failed to update trusted device last_used_at", "error", err)
	}
	return true
}

// ListActiveTrustedDevices returns a user's non-revoked, unexpired devices,
// for the security settings list.
func (s *Store) ListActiveTrustedDevices(userID string) ([]*core.Record, error) {
	records, err := s.app.FindAllRecords(collTrustedDevices, dbx.HashExp{"user": userID})
	if err != nil {
		return nil, err
	}
	now := types.NowDateTime()
	active := make([]*core.Record, 0, len(records))
	for _, record := range records {
		if !record.GetDateTime("revoked_at").IsZero() {
			continue
		}
		if expires := record.GetDateTime("expires_at"); expires.IsZero() || expires.Before(now) {
			continue
		}
		active = append(active, record)
	}
	return active, nil
}

// RevokeTrustedDevice revokes a single device by id, but only if it belongs to
// the given user. Returns ErrNotFound otherwise.
func (s *Store) RevokeTrustedDevice(userID, deviceID string) error {
	record, err := s.app.FindRecordById(collTrustedDevices, deviceID)
	if err != nil {
		if isNoRows(err) {
			return ErrNotFound
		}
		return err
	}
	if record.GetString("user") != userID {
		return ErrNotFound
	}
	if !record.GetDateTime("revoked_at").IsZero() {
		return nil
	}
	record.Set("revoked_at", types.NowDateTime())
	return s.app.Save(record)
}

// RevokeAllTrustedDevices marks every active trust for a user as revoked. Used
// on logout, MFA disable, recovery-code regeneration, and password change.
func (s *Store) RevokeAllTrustedDevices(userID string) error {
	records, err := s.app.FindAllRecords(collTrustedDevices, dbx.HashExp{"user": userID})
	if err != nil {
		return err
	}
	now := types.NowDateTime()
	for _, record := range records {
		if !record.GetDateTime("revoked_at").IsZero() {
			continue
		}
		record.Set("revoked_at", now)
		if err := s.app.Save(record); err != nil {
			return err
		}
	}
	return nil
}

// --- per-user MFA lockout --------------------------------------------------

// MFALockedUntil returns the time until which the user's second factor is
// locked, or the zero time if not locked.
func MFALockedUntil(user *core.Record) types.DateTime {
	return user.GetDateTime("mfa_locked_until")
}

// IsMFALocked reports whether the user is currently in an MFA cooldown.
func IsMFALocked(user *core.Record) bool {
	until := MFALockedUntil(user)
	return !until.IsZero() && until.After(types.NowDateTime())
}

// RecordMFAFailure increments the per-user failure counter and locks the second
// factor for a cooldown once the threshold is hit. Returns whether locked.
func (s *Store) RecordMFAFailure(user *core.Record) (locked bool, err error) {
	attempts := user.GetInt("mfa_failed_attempts") + 1
	user.Set("mfa_failed_attempts", attempts)
	if attempts >= MaxUserMFAFailures {
		user.Set("mfa_locked_until", types.NowDateTime().Add(MFALockoutDuration))
		user.Set("mfa_failed_attempts", 0)
		locked = true
	}
	if err := s.app.Save(user); err != nil {
		return false, err
	}
	return locked, nil
}

// ClearMFAFailures resets the per-user failure state after a successful verify.
func (s *Store) ClearMFAFailures(user *core.Record) error {
	if user.GetInt("mfa_failed_attempts") == 0 && user.GetDateTime("mfa_locked_until").IsZero() {
		return nil
	}
	user.Set("mfa_failed_attempts", 0)
	user.Set("mfa_locked_until", types.DateTime{})
	return s.app.Save(user)
}

// PruneExpiredSessions is a best-effort cleanup helper callers may schedule; it
// removes consumed or expired sessions to keep the table small.
func (s *Store) PruneExpiredSessions(now time.Time) error {
	records, err := s.app.FindAllRecords(collAuthSessions)
	if err != nil {
		return err
	}
	for _, record := range records {
		expires := record.GetDateTime("expires_at")
		consumed := record.GetDateTime("consumed_at")
		if (!expires.IsZero() && expires.Time().Before(now)) || !consumed.IsZero() {
			if err := s.app.Delete(record); err != nil {
				return err
			}
		}
	}
	return nil
}
