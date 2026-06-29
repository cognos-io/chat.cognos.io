package mfa

import "time"

const (
	// AuthSessionTTL is how long the password→second-factor window stays open.
	// Short, because it only needs to cover the time to read a code from an app.
	AuthSessionTTL = 10 * time.Minute

	// TrustedDeviceTTL is how long a "remember this device" token waives the
	// second factor before the user must verify again.
	TrustedDeviceTTL = 30 * 24 * time.Hour

	// MaxSessionFailures burns an MFA session after this many bad codes, forcing
	// the user back through password auth (and a fresh session).
	MaxSessionFailures = 5

	// MaxUserMFAFailures / MFALockoutDuration mirror the password lockout
	// (login_lockout.go): a 6-digit code is far more guessable than a password,
	// so the second factor gets its own per-account cooldown on top of the
	// per-session burn and the per-IP rate limit.
	MaxUserMFAFailures = 5
	MFALockoutDuration = 15 * time.Minute

	// MFADeviceHeader carries the opaque trusted-device token on the password
	// sign-in request so the interceptor can waive the code step.
	MFADeviceHeader = "X-Cognos-MFA-Device"
)
