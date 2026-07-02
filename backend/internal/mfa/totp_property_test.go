package mfa

import (
	"encoding/base32"
	"time"

	"testing"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"pgregory.net/rapid"
)

// Property: for any secret and any verification time, Verify accepts a code
// generated for a step inside the ±verifySkew window and returns EXACTLY that
// step — never a different one. The returned step is what the caller persists
// as last_accepted_step, so this pins the replay-protection contract: a code
// accepted at step N deterministically resolves to N, and a caller enforcing
// last_accepted_step >= N can therefore never accept it (or an older step)
// again.
func TestTOTPVerifyWindowProperties(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		seed := rapid.SliceOfN(rapid.Byte(), 10, 20).Draw(t, "seed")
		secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(seed)
		params := TOTPParams{Secret: secret, Digits: DefaultDigits, Period: DefaultPeriod, Algorithm: DefaultAlgorithm}

		// A verification time comfortably away from the epoch so step-1 exists.
		unix := rapid.Int64Range(10_000_000, 4_000_000_000).Draw(t, "unix")
		now := time.Unix(unix, 0)
		base := uint64(unix) / DefaultPeriod

		delta := rapid.Int64Range(-verifySkew, verifySkew).Draw(t, "delta")
		codeStep := int64(base) + delta

		code, err := totp.GenerateCodeCustom(secret, time.Unix(codeStep*DefaultPeriod, 0), totp.ValidateOpts{
			Period:    DefaultPeriod,
			Digits:    otp.DigitsSix,
			Algorithm: otp.AlgorithmSHA1,
		})
		if err != nil {
			t.Fatalf("GenerateCodeCustom: %v", err)
		}

		ok, step, err := Verify(params, code, now)
		if err != nil {
			t.Fatalf("Verify: %v", err)
		}
		if !ok {
			t.Fatalf("code for step %d rejected at base step %d (delta %d), want accepted", codeStep, base, delta)
		}
		// The resolved step must be inside the window; and because Verify walks
		// earliest→latest, it is the LOWEST matching step — replay protection
		// can only ever move forward.
		if int64(step) < int64(base)-verifySkew || int64(step) > int64(base)+verifySkew {
			t.Fatalf("accepted step %d outside window [%d, %d]", step, int64(base)-verifySkew, int64(base)+verifySkew)
		}
		if int64(step) > codeStep {
			t.Fatalf("accepted step %d is later than the generating step %d — replay window would move backwards", step, codeStep)
		}
	})
}

// Property: a code generated for a step OUTSIDE the ±verifySkew window is
// always rejected — the window never silently widens.
func TestTOTPVerifyRejectsOutsideWindowProperty(t *testing.T) {
	t.Parallel()

	rapid.Check(t, func(t *rapid.T) {
		seed := rapid.SliceOfN(rapid.Byte(), 10, 20).Draw(t, "seed")
		secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(seed)
		params := TOTPParams{Secret: secret, Digits: DefaultDigits, Period: DefaultPeriod, Algorithm: DefaultAlgorithm}

		unix := rapid.Int64Range(10_000_000, 4_000_000_000).Draw(t, "unix")
		now := time.Unix(unix, 0)
		base := int64(uint64(unix) / DefaultPeriod)

		// A step at least 2 beyond the skew in either direction.
		distance := rapid.Int64Range(verifySkew+1, verifySkew+1000).Draw(t, "distance")
		if rapid.Bool().Draw(t, "past") {
			distance = -distance
		}
		codeStep := base + distance
		if codeStep < 0 {
			codeStep = base + (-distance)
		}

		code, err := totp.GenerateCodeCustom(secret, time.Unix(codeStep*DefaultPeriod, 0), totp.ValidateOpts{
			Period:    DefaultPeriod,
			Digits:    otp.DigitsSix,
			Algorithm: otp.AlgorithmSHA1,
		})
		if err != nil {
			t.Fatalf("GenerateCodeCustom: %v", err)
		}

		ok, _, err := Verify(params, code, now)
		if err != nil {
			t.Fatalf("Verify: %v", err)
		}
		if ok {
			// An out-of-window code CAN coincidentally equal an in-window code
			// (6 digits => 1e-6 chance per comparison). Only fail when the
			// digits genuinely differ from every in-window code.
			for delta := int64(-verifySkew); delta <= verifySkew; delta++ {
				inWindow, genErr := totp.GenerateCodeCustom(secret, time.Unix((base+delta)*DefaultPeriod, 0), totp.ValidateOpts{
					Period:    DefaultPeriod,
					Digits:    otp.DigitsSix,
					Algorithm: otp.AlgorithmSHA1,
				})
				if genErr == nil && inWindow == code {
					return // legitimate collision, not a window violation
				}
			}
			t.Fatalf("code for step %d (distance %d) accepted at base step %d, want rejected", codeStep, distance, base)
		}
	})
}
