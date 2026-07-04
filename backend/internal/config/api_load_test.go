package config

import (
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
)

func TestMustLoadAPIConfig_ReadsInfomaniakProductIDFromEnv(t *testing.T) {
	dir := t.TempDir()
	if err := changeDir(t, dir); err != nil {
		t.Fatalf("changeDir(%q) error = %v", dir, err)
	}

	t.Setenv("COGNOS_INFOMANIAK_PRODUCT_ID", "test-product-id")
	t.Setenv("COGNOS_INFOMANIAK_API_KEY", "test-key")
	t.Setenv("COGNOS_INFOMANIAK_URL", "https://example.test/")

	cfg := MustLoadAPIConfig(slog.New(slog.NewTextHandler(io.Discard, nil)))

	if cfg.InfomaniakProductID != "test-product-id" {
		t.Errorf("InfomaniakProductID = %q, want %q", cfg.InfomaniakProductID, "test-product-id")
	}
	if cfg.InfomaniakAPIKey != "test-key" {
		t.Errorf("InfomaniakAPIKey = %q, want %q", cfg.InfomaniakAPIKey, "test-key")
	}
	if cfg.InfomaniakAPIURL != "https://example.test/" {
		t.Errorf("InfomaniakAPIURL = %q, want %q", cfg.InfomaniakAPIURL, "https://example.test/")
	}
}

func TestMustLoadAPIConfig_ReadsAllProviderEnvVars(t *testing.T) {
	dir := t.TempDir()
	if err := changeDir(t, dir); err != nil {
		t.Fatalf("changeDir(%q) error = %v", dir, err)
	}

	envVars := map[string]string{
		"COGNOS_BIFROST_LOG_LEVEL":                     "debug",
		"COGNOS_INFOMANIAK_API_KEY":                    "infomaniak-key",
		"COGNOS_INFOMANIAK_URL":                        "https://infomaniak.test/",
		"COGNOS_INFOMANIAK_PRODUCT_ID":                 "product-id",
		"COGNOS_REQUESTY_URL":                          "https://requesty.test/",
		"COGNOS_REQUESTY_API_KEY":                      "requesty-key",
		"COGNOS_BILLING_TRIAL_SEED_RAPPEN":             "500",
		"COGNOS_REQUESTY_FORCE_DISABLE_ABSENT":         "true",
		"COGNOS_BILLING_WEB_SEARCH_FLOOR_MICRO_RAPPEN": "12345",
	}
	for k, v := range envVars {
		t.Setenv(k, v)
	}

	cfg := MustLoadAPIConfig(slog.New(slog.NewTextHandler(io.Discard, nil)))

	cases := []struct {
		field string
		got   string
		want  string
	}{
		{"BifrostLogLevel", cfg.BifrostLogLevel, "debug"},
		{"InfomaniakAPIKey", cfg.InfomaniakAPIKey, "infomaniak-key"},
		{"InfomaniakAPIURL", cfg.InfomaniakAPIURL, "https://infomaniak.test/"},
		{"InfomaniakProductID", cfg.InfomaniakProductID, "product-id"},
		{"RequestyAPIURL", cfg.RequestyAPIURL, "https://requesty.test/"},
		{"RequestyAPIKey", cfg.RequestyAPIKey, "requesty-key"},
	}
	for _, tc := range cases {
		if tc.got != tc.want {
			t.Errorf("%s = %q, want %q", tc.field, tc.got, tc.want)
		}
	}
	if cfg.BillingTrialSeedRappen != 500 {
		t.Errorf("BillingTrialSeedRappen = %d, want 500", cfg.BillingTrialSeedRappen)
	}
	if cfg.BillingWebSearchFloorMicroRappen != 12345 {
		t.Errorf("BillingWebSearchFloorMicroRappen = %d, want 12345", cfg.BillingWebSearchFloorMicroRappen)
	}
	if !cfg.RequestyForceDisableAbsent {
		t.Errorf("RequestyForceDisableAbsent = false, want true (bool env coercion)")
	}
}

func TestMustLoadAPIConfig_DefaultsBillingTrialSeed(t *testing.T) {
	dir := t.TempDir()
	if err := changeDir(t, dir); err != nil {
		t.Fatalf("changeDir(%q) error = %v", dir, err)
	}

	cfg := MustLoadAPIConfig(slog.New(slog.NewTextHandler(io.Discard, nil)))

	if cfg.BifrostLogLevel != "error" {
		t.Errorf("BifrostLogLevel = %q, want %q", cfg.BifrostLogLevel, "error")
	}
	if cfg.BillingTrialSeedRappen != 200 {
		t.Errorf("BillingTrialSeedRappen = %d, want 200", cfg.BillingTrialSeedRappen)
	}
}

// The web-search floor fee must never resolve to zero (or search would be
// silently free), so unset/zero/negative env values all fall back to the
// seeded billing default; a positive override is honoured as-is.
func TestMustLoadAPIConfig_BillingWebSearchFloorMicroRappen(t *testing.T) {
	tests := []struct {
		name   string
		envVal string // empty means the env var is left unset
		want   int64
	}{
		{"unset defaults to seeded floor", "", billing.DefaultWebSearchFloorMicroRappen},
		{"zero defaults to seeded floor", "0", billing.DefaultWebSearchFloorMicroRappen},
		{"negative defaults to seeded floor", "-100", billing.DefaultWebSearchFloorMicroRappen},
		{"positive override honoured", "12345", 12345},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := changeDir(t, dir); err != nil {
				t.Fatalf("changeDir(%q) error = %v", dir, err)
			}
			if tt.envVal != "" {
				t.Setenv("COGNOS_BILLING_WEB_SEARCH_FLOOR_MICRO_RAPPEN", tt.envVal)
			}

			cfg := MustLoadAPIConfig(slog.New(slog.NewTextHandler(io.Discard, nil)))

			if cfg.BillingWebSearchFloorMicroRappen != tt.want {
				t.Errorf("BillingWebSearchFloorMicroRappen = %d, want %d",
					cfg.BillingWebSearchFloorMicroRappen, tt.want)
			}
		})
	}
}

func changeDir(t *testing.T, dir string) error {
	t.Helper()
	t.Chdir(dir)
	_, err := filepath.Abs(".")
	return err
}
