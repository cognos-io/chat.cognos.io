package gateway

import (
	"context"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/maximhq/bifrost/core/schemas"
)

func TestNewStaticAccountFromAPIConfigBuildsInfomaniakCustomProvider(t *testing.T) {
	t.Parallel()

	account, err := NewStaticAccountFromAPIConfig(&config.APIConfig{
		InfomaniakAPIKey:    "test-key",
		InfomaniakProductID: "product-123",
	})
	if err != nil {
		t.Fatalf("NewStaticAccountFromAPIConfig() error = %v, want nil", err)
	}

	cfg, err := account.GetConfigForProvider(schemas.ModelProvider("infomaniak"))
	if err != nil {
		t.Fatalf("GetConfigForProvider(infomaniak) error = %v, want nil", err)
	}
	if cfg.CustomProviderConfig == nil {
		t.Fatal("CustomProviderConfig = nil, want non-nil")
	}
	if cfg.CustomProviderConfig.BaseProviderType != schemas.OpenAI {
		t.Fatalf("BaseProviderType = %q, want %q", cfg.CustomProviderConfig.BaseProviderType, schemas.OpenAI)
	}
	if cfg.NetworkConfig.BaseURL != "https://api.infomaniak.com/2/ai/product-123/openai" {
		t.Fatalf("BaseURL = %q", cfg.NetworkConfig.BaseURL)
	}
	if cfg.OpenAIConfig == nil || !cfg.OpenAIConfig.DisableStore {
		t.Fatal("OpenAIConfig.DisableStore = false, want true")
	}

	keys, err := account.GetKeysForProvider(context.Background(), schemas.ModelProvider("infomaniak"))
	if err != nil {
		t.Fatalf("GetKeysForProvider(infomaniak) error = %v, want nil", err)
	}
	if len(keys) != 1 {
		t.Fatalf("len(keys) = %d, want %d", len(keys), 1)
	}
	if keys[0].Value.Val != "test-key" {
		t.Fatalf("key value = %q, want %q", keys[0].Value.Val, "test-key")
	}
}

func TestNewStaticAccountFromAPIConfigBuildsRequestyEUGatewayByDefault(t *testing.T) {
	t.Parallel()

	account, err := NewStaticAccountFromAPIConfig(&config.APIConfig{RequestyAPIKey: "requesty-key"})
	if err != nil {
		t.Fatalf("NewStaticAccountFromAPIConfig() error = %v, want nil", err)
	}

	cfg, err := account.GetConfigForProvider(schemas.ModelProvider("requesty"))
	if err != nil {
		t.Fatalf("GetConfigForProvider(requesty) error = %v, want nil", err)
	}
	if cfg.CustomProviderConfig == nil || cfg.CustomProviderConfig.BaseProviderType != schemas.OpenAI {
		t.Fatalf("requesty BaseProviderType = %#v, want openai", cfg.CustomProviderConfig)
	}
	if cfg.NetworkConfig.BaseURL != "https://router.eu.requesty.ai/v1" {
		t.Fatalf("BaseURL = %q, want EU gateway default", cfg.NetworkConfig.BaseURL)
	}
	if cfg.OpenAIConfig == nil || !cfg.OpenAIConfig.DisableStore {
		t.Fatal("OpenAIConfig.DisableStore = false, want true")
	}
}

func TestNewStaticAccountFromAPIConfigHonoursRequestyURLOverride(t *testing.T) {
	t.Parallel()

	account, err := NewStaticAccountFromAPIConfig(&config.APIConfig{
		RequestyAPIKey: "requesty-key",
		RequestyAPIURL: "https://router.requesty.ai/v1",
	})
	if err != nil {
		t.Fatalf("NewStaticAccountFromAPIConfig() error = %v, want nil", err)
	}

	cfg, err := account.GetConfigForProvider(schemas.ModelProvider("requesty"))
	if err != nil {
		t.Fatalf("GetConfigForProvider(requesty) error = %v, want nil", err)
	}
	if cfg.NetworkConfig.BaseURL != "https://router.requesty.ai/v1" {
		t.Fatalf("BaseURL = %q, want override", cfg.NetworkConfig.BaseURL)
	}
}
