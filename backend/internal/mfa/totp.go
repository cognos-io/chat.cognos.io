package mfa

import (
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

const (
	// DefaultDigits / DefaultPeriod / DefaultAlgorithm are the standard
	// authenticator-app parameters (Google Authenticator, 1Password, Authy, …).
	DefaultDigits    = 6
	DefaultPeriod    = 30
	DefaultAlgorithm = "SHA1"

	// verifySkew is how many 30s steps either side of "now" we accept, to absorb
	// clock drift between the server and the user's device. ±1 step => a code is
	// valid for at most ~90s. Kept deliberately tight.
	verifySkew = 1
)

// TOTPParams describes an enrolled authenticator. Stored per user_mfa_totp row
// so verification uses exactly the parameters the QR code was generated with.
type TOTPParams struct {
	Secret    string // base32, the raw seed material
	Digits    int
	Period    int
	Algorithm string
}

func (p TOTPParams) digits() otp.Digits {
	if p.Digits == 8 {
		return otp.DigitsEight
	}
	return otp.DigitsSix
}

func (p TOTPParams) period() uint {
	if p.Period > 0 {
		return uint(p.Period)
	}
	return DefaultPeriod
}

func (p TOTPParams) algorithm() otp.Algorithm {
	switch p.Algorithm {
	case "SHA256":
		return otp.AlgorithmSHA256
	case "SHA512":
		return otp.AlgorithmSHA512
	default:
		return otp.AlgorithmSHA1
	}
}

// GenerateSecret creates a fresh TOTP secret and provisioning key for the given
// account. The returned key exposes the base32 secret (key.Secret()) and the
// otpauth:// provisioning URI (key.URL()) used to render the QR code.
func GenerateSecret(issuer, accountName string) (*otp.Key, error) {
	return totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: accountName,
		Period:      DefaultPeriod,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
}

// Verify checks a submitted code against the params at time t, accepting a small
// clock-skew window. On success it returns the timestep the code belongs to so
// the caller can reject replay of the same or an older step (store it as
// last_accepted_step). A step of 0 with ok=false means no match.
//
// We don't use totp.ValidateCustom directly because it doesn't surface which
// step matched, and we need that for replay protection.
func Verify(params TOTPParams, code string, t time.Time) (ok bool, step uint64, err error) {
	period := params.period()
	periodSeconds := params.Period
	if periodSeconds <= 0 {
		periodSeconds = DefaultPeriod
	}
	if t.Unix() < 0 {
		return false, 0, nil
	}
	opts := totp.ValidateOpts{
		Period:    period,
		Skew:      0, // we walk the window ourselves to learn the matched step
		Digits:    params.digits(),
		Algorithm: params.algorithm(),
	}

	base := t.Unix() / int64(periodSeconds)

	// Walk earliest→latest so a code valid in overlapping windows resolves to the
	// lowest matching step; combined with the strict last_accepted_step check this
	// can only ever move replay protection forward.
	for delta := -verifySkew; delta <= verifySkew; delta++ {
		candidateStep := int64(base) + int64(delta)
		if candidateStep < 0 {
			continue
		}
		stepTime := time.Unix(candidateStep*int64(periodSeconds), 0)

		expected, genErr := totp.GenerateCodeCustom(params.Secret, stepTime, opts)
		if genErr != nil {
			return false, 0, genErr
		}
		if constantTimeEqual(expected, code) {
			return true, uint64(candidateStep), nil
		}
	}

	return false, 0, nil
}
