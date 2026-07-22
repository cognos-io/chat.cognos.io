package config

import (
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/env"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/v2"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
)

func pathExists(path string) bool {
	_, err := os.Stat(path)
	if err == nil {
		return true
	}
	if os.IsNotExist(err) {
		return false
	}
	return false
}

func readSecretFile(path string) (string, error) {
	// #nosec G304,G703 -- the path comes from an operator-controlled *_FILE setting.
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(contents)), nil
}

// configEnvPrefix is the env-var prefix Cognos expects for runtime overrides.
// Centralising it here keeps the env provider, file-secret overrides, and any
// future code paths in lockstep.
const configEnvPrefix = "COGNOS_"

// envKeyToConfigPath maps an environment variable like
// "COGNOS_INFOMANIAK_PRODUCT_ID" to the koanf flat-path key
// "infomaniak.product_id". The first underscore after the Cognos prefix
// becomes the section delimiter; any remaining underscores stay intact so
// identifiers like "api_key" and "trial_seed_rappen" round-trip correctly.
//
// Returning "" tells the env provider to ignore the variable entirely.
func envKeyToConfigPath(envKey string) string {
	if !strings.HasPrefix(envKey, configEnvPrefix) {
		return ""
	}
	lower := strings.ToLower(strings.TrimPrefix(envKey, configEnvPrefix))
	idx := strings.Index(lower, "_")
	if idx == -1 {
		return lower
	}
	return lower[:idx] + "." + lower[idx+1:]
}

func fileEnvValue(envVar string) (string, error) {
	path := strings.TrimSpace(os.Getenv(envVar))
	if path == "" {
		return "", nil
	}

	return readSecretFile(path)
}

type APIConfig struct {
	// Bifrost
	BifrostLogLevel string `koanf:"bifrost.log_level"`
	// Infomaniak (Swiss, OpenAI-compatible AI proxy)
	InfomaniakAPIKey    string `koanf:"infomaniak.api_key"`
	InfomaniakAPIURL    string `koanf:"infomaniak.url"`
	InfomaniakProductID string `koanf:"infomaniak.product_id"`
	// Requesty (OpenAI-compatible EU gateway)
	RequestyAPIKey string `koanf:"requesty.api_key"`
	RequestyAPIURL string `koanf:"requesty.url"`
	// RequestyForceDisableAbsent makes the scheduled sync mark Models missing
	// from Requesty unavailable even when the absent share trips the health
	// guard (COGNOS_REQUESTY_FORCE_DISABLE_ABSENT=true). Off by default; the CLI
	// has a per-run --force-disable-absent flag for one-off cleanups.
	RequestyForceDisableAbsent bool `koanf:"requesty.force_disable_absent"`
	// GatewayGroundingRedirectPrefix is the URL prefix whose citations are
	// resolved to their destination per completion (Vertex/Gemini grounding
	// redirects). Empty falls back to gateway.DefaultGroundingRedirectPrefix.
	// e2e overrides it to the mock provider's origin.
	GatewayGroundingRedirectPrefix string `koanf:"gateway.grounding_redirect_prefix"`
	// Billing
	BillingTrialSeedRappen             int64 `koanf:"billing.trial_seed_rappen"`
	BillingPaygMinCommitRappen         int64 `koanf:"billing.payg_min_commit_rappen"`
	BillingUnlimitedFairUseAlertRappen int64 `koanf:"billing.unlimited_fair_use_alert_rappen"`
	// BillingMarginBPS is the markup over provider cost in basis points
	// (2200 = 22%). Defaults to billing.DefaultMarginBPS.
	BillingMarginBPS int64 `koanf:"billing.margin_bps"`
	// BillingWebSearchFloorMicroRappen is the per-search floor fee added
	// whenever a completion counts provider web searches. Unset or
	// non-positive falls back to billing.DefaultWebSearchFloorMicroRappen —
	// it must never resolve to zero, or search would be silently free.
	BillingWebSearchFloorMicroRappen int64 `koanf:"billing.web_search_floor_micro_rappen"`
	// Paddle (payments). Prices are Paddle price IDs (pri_...).
	PaddleAPIBase               string `koanf:"paddle.api_base"`
	PaddleAPIKey                string `koanf:"paddle.api_key"`
	PaddleWebhookSecret         string `koanf:"paddle.webhook_secret"`
	PaddlePricePAYG             string `koanf:"paddle.price_payg"`
	PaddlePricePAYGOverage      string `koanf:"paddle.price_payg_overage"`
	PaddlePriceUnlimitedMonthly string `koanf:"paddle.price_unlimited_monthly"`
	PaddlePriceUnlimitedAnnual  string `koanf:"paddle.price_unlimited_annual"`
	// PaddlePriceOrgSeat is the per-Seat price (CHF 15/seat/month) an
	// Organisation subscription carries with quantity = active Seats.
	PaddlePriceOrgSeat string `koanf:"paddle.price_org_seat"`
	// MFA. MFATOTPEncryptionKey is a server-held key (base64-encoded 32 bytes)
	// used to encrypt TOTP seeds at rest. Without it, TOTP enrolment is disabled
	// (we never store seeds in plaintext). MFATOTPEncryptionKeyPrevious holds
	// one or more retired keys (comma-separated) so existing seeds can be opened
	// and lazily re-sealed under the primary during verification.
	MFATOTPEncryptionKey string `koanf:"mfa.totp_encryption_key"`
	// MFATOTPEncryptionKeyPrevious is optional; comma-separated base64 keys.
	MFATOTPEncryptionKeyPrevious string `koanf:"mfa.totp_encryption_key_previous"`
}

// MustLoadAPIConfig loads the API configuration or panics if an error occurs.
func MustLoadAPIConfig(logger *slog.Logger) *APIConfig {
	var err error

	k := koanf.New(".")

	environments := []string{"development", "production", "local"}

	// Load from yaml file based on environment
	for _, env := range environments {
		configFilePath := fmt.Sprintf("configs/api.%s.yaml", env)
		if !pathExists(configFilePath) {
			continue
		}

		logger.Info("loading config from file", "file", configFilePath)

		err = k.Load(file.Provider(configFilePath), yaml.Parser())
		if err != nil {
			panic(err)
		}
	}

	// Load from environment variables. Map COGNOS_<SECTION>_<REST> to the
	// koanf tag form <section>.<rest> while preserving any further
	// underscores inside the key (e.g. api_key, product_id).
	err = k.Load(env.Provider("COGNOS_", ".", envKeyToConfigPath), nil)
	if err != nil {
		panic(err)
	}

	// Unpack into our config struct
	var c APIConfig
	err = k.UnmarshalWithConf(
		"",
		&c,
		koanf.UnmarshalConf{Tag: "koanf", FlatPaths: true},
	)
	if err != nil {
		panic(err)
	}

	if strings.TrimSpace(c.BifrostLogLevel) == "" {
		c.BifrostLogLevel = "error"
	}

	if c.BillingTrialSeedRappen <= 0 {
		c.BillingTrialSeedRappen = 200
	}

	if c.BillingPaygMinCommitRappen <= 0 {
		c.BillingPaygMinCommitRappen = billing.DefaultPAYGMinCommitRappen
	}

	if c.BillingUnlimitedFairUseAlertRappen <= 0 {
		c.BillingUnlimitedFairUseAlertRappen = billing.DefaultFairUseAlertRappen
	}

	if c.BillingMarginBPS <= 0 {
		c.BillingMarginBPS = billing.DefaultMarginBPS
	}

	if c.BillingWebSearchFloorMicroRappen <= 0 {
		c.BillingWebSearchFloorMicroRappen = billing.DefaultWebSearchFloorMicroRappen
	}

	if strings.TrimSpace(c.PaddleAPIBase) == "" {
		c.PaddleAPIBase = "https://api.paddle.com"
	}

	for _, override := range []struct {
		envVar string
		apply  func(string)
	}{
		{envVar: "COGNOS_INFOMANIAK_API_KEY_FILE", apply: func(value string) { c.InfomaniakAPIKey = value }},
		{envVar: "COGNOS_REQUESTY_API_KEY_FILE", apply: func(value string) { c.RequestyAPIKey = value }},
		{envVar: "COGNOS_PADDLE_API_KEY_FILE", apply: func(value string) { c.PaddleAPIKey = value }},
		{envVar: "COGNOS_PADDLE_WEBHOOK_SECRET_FILE", apply: func(value string) { c.PaddleWebhookSecret = value }},
		{envVar: "COGNOS_MFA_TOTP_ENCRYPTION_KEY_FILE", apply: func(value string) { c.MFATOTPEncryptionKey = value }},
		{envVar: "COGNOS_MFA_TOTP_ENCRYPTION_KEY_PREVIOUS_FILE", apply: func(value string) { c.MFATOTPEncryptionKeyPrevious = value }},
	} {
		value, err := fileEnvValue(override.envVar)
		if err != nil {
			panic(err)
		}
		if value == "" {
			continue
		}
		override.apply(value)
	}

	return &c
}
