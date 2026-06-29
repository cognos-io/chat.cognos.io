package mfa

import (
	"testing"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

func testParams(t *testing.T) TOTPParams {
	t.Helper()
	key, err := GenerateSecret("Cognos", "user@example.com")
	if err != nil {
		t.Fatalf("generate secret: %v", err)
	}
	return TOTPParams{
		Secret:    key.Secret(),
		Digits:    DefaultDigits,
		Period:    DefaultPeriod,
		Algorithm: DefaultAlgorithm,
	}
}

func codeAt(t *testing.T, params TOTPParams, at time.Time) string {
	t.Helper()
	code, err := totp.GenerateCodeCustom(params.Secret, at, totp.ValidateOpts{
		Period:    uint(params.Period),
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	if err != nil {
		t.Fatalf("generate code: %v", err)
	}
	return code
}

func TestGenerateSecretProducesProvisioningURI(t *testing.T) {
	t.Parallel()
	key, err := GenerateSecret("Cognos", "user@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if key.Secret() == "" {
		t.Fatal("expected a non-empty base32 secret")
	}
	if got := key.URL(); got == "" || key.Issuer() != "Cognos" {
		t.Fatalf("unexpected provisioning key: url=%q issuer=%q", got, key.Issuer())
	}
}

func TestVerify(t *testing.T) {
	t.Parallel()
	params := testParams(t)
	now := time.Unix(1_700_000_000, 0)
	period := int64(params.Period)

	tests := []struct {
		name   string
		code   func() string
		wantOK bool
	}{
		{name: "current step accepted", code: func() string { return codeAt(t, params, now) }, wantOK: true},
		{name: "previous step accepted (drift)", code: func() string { return codeAt(t, params, now.Add(-time.Duration(period)*time.Second)) }, wantOK: true},
		{name: "next step accepted (drift)", code: func() string { return codeAt(t, params, now.Add(time.Duration(period)*time.Second)) }, wantOK: true},
		{name: "two steps back rejected", code: func() string { return codeAt(t, params, now.Add(-2*time.Duration(period)*time.Second)) }, wantOK: false},
		{name: "two steps forward rejected", code: func() string { return codeAt(t, params, now.Add(2*time.Duration(period)*time.Second)) }, wantOK: false},
		{name: "garbage rejected", code: func() string { return "000000" }, wantOK: false},
		{name: "empty rejected", code: func() string { return "" }, wantOK: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ok, step, err := Verify(params, tc.code(), now)
			if err != nil {
				t.Fatalf("verify error: %v", err)
			}
			if ok != tc.wantOK {
				t.Fatalf("want ok=%v got ok=%v (step=%d)", tc.wantOK, ok, step)
			}
			if ok && step == 0 {
				t.Fatal("a valid code must report its non-zero step for replay protection")
			}
		})
	}
}

// The matched step must advance with time so the caller can store
// last_accepted_step and reject replays of the same or an earlier code.
func TestVerifyStepMonotonicity(t *testing.T) {
	t.Parallel()
	params := testParams(t)
	now := time.Unix(1_700_000_000, 0)
	later := now.Add(time.Duration(params.Period) * time.Second)

	_, stepNow, err := Verify(params, codeAt(t, params, now), now)
	if err != nil {
		t.Fatal(err)
	}
	_, stepLater, err := Verify(params, codeAt(t, params, later), later)
	if err != nil {
		t.Fatal(err)
	}
	if stepLater <= stepNow {
		t.Fatalf("step should advance: now=%d later=%d", stepNow, stepLater)
	}
}
