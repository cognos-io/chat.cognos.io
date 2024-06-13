package config

import (
	"fmt"
	"log/slog"
	"os"

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

type APIConfig struct {
	OpenAIAPIKey        string `koanf:"openai.api_key"`
	CloudflareAccountID string `koanf:"cloudflare.account_id"`
	CloudflareAPIKey    string `koanf:"cloudflare.api_key"`
	GoogleGeminiAPIKey  string `koanf:"google.api_key"`
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
	return &c
}
