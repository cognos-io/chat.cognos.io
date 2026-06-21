package config

import (
	"io"
	"log/slog"
	"path/filepath"
	"testing"
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
		"COGNOS_BIFROST_LOG_LEVEL":         "debug",
		"COGNOS_INFOMANIAK_API_KEY":        "infomaniak-key",
		"COGNOS_INFOMANIAK_URL":            "https://infomaniak.test/",
		"COGNOS_INFOMANIAK_PRODUCT_ID":     "product-id",
		"COGNOS_REQUESTY_URL":              "https://requesty.test/",
		"COGNOS_REQUESTY_API_KEY":          "requesty-key",
		"COGNOS_BILLING_TRIAL_SEED_RAPPEN": "500",
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

func changeDir(t *testing.T, dir string) error {
	t.Helper()
	t.Chdir(dir)
	_, err := filepath.Abs(".")
	return err
}
