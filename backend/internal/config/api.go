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
	contents, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(contents)), nil
}

func fileEnvValue(envVar string) (string, error) {
	path := strings.TrimSpace(os.Getenv(envVar))
	if path == "" {
		return "", nil
	}

	return readSecretFile(path)
}

type APIConfig struct {
	// OpenAI
	OpenAIAPIKey string `koanf:"openai.api_key"`
	// Infomaniak
	InfomaniakAPIKey    string `koanf:"infomaniak.api_key"`
	InfomaniakAPIURL    string `koanf:"infomaniak.url"`
	InfomaniakProductID string `koanf:"infomaniak.product_id"`
	// Cloudflare
	CloudflareAccountID string `koanf:"cloudflare.account_id"`
	CloudflareAPIKey    string `koanf:"cloudflare.api_key"`
	// Google Gemini
	GoogleGeminiAPIKey string `koanf:"google.api_key"`
	// Anthropic
	AnthropicAPIKey string `koanf:"anthropic.api_key"`
	AnthropicAPIURL string `koanf:"anthropic.url"`
	// DeepInfra
	DeepInfraAPIURL string `koanf:"deepinfra.url"`
	DeepInfraAPIKey string `koanf:"deepinfra.api_key"`
	// Billing
	BillingTrialSeedRappen int64 `koanf:"billing.trial_seed_rappen"`
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

	// Load from environment variables
	err = k.Load(env.Provider("COGNOS_", ".", nil), nil)
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

	if c.BillingTrialSeedRappen <= 0 {
		c.BillingTrialSeedRappen = 200
	}

	for _, override := range []struct {
		envVar string
		apply  func(string)
	}{
		{envVar: "COGNOS_OPENAI_API_KEY_FILE", apply: func(value string) { c.OpenAIAPIKey = value }},
		{envVar: "COGNOS_INFOMANIAK_API_KEY_FILE", apply: func(value string) { c.InfomaniakAPIKey = value }},
		{envVar: "COGNOS_CLOUDFLARE_API_KEY_FILE", apply: func(value string) { c.CloudflareAPIKey = value }},
		{envVar: "COGNOS_GOOGLE_API_KEY_FILE", apply: func(value string) { c.GoogleGeminiAPIKey = value }},
		{envVar: "COGNOS_ANTHROPIC_API_KEY_FILE", apply: func(value string) { c.AnthropicAPIKey = value }},
		{envVar: "COGNOS_DEEPINFRA_API_KEY_FILE", apply: func(value string) { c.DeepInfraAPIKey = value }},
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
