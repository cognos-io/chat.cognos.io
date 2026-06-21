package gateway

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/maximhq/bifrost/core/schemas"
)

const (
	defaultProviderWeight = 100
	deepInfraDefaultURL   = "https://api.deepinfra.com/v1/openai"
	// requestyDefaultURL is Requesty's EU gateway. Pointing at this host keeps
	// Requesty's request processing zero-retention and in-region (Frankfurt);
	// full EU residency additionally requires EU-region model ids.
	requestyDefaultURL = "https://router.eu.requesty.ai/v1"
)

type StaticAccount struct {
	configs map[schemas.ModelProvider]*schemas.ProviderConfig
	keys    map[schemas.ModelProvider][]schemas.Key
}

func NewStaticAccount() *StaticAccount {
	return &StaticAccount{
		configs: make(map[schemas.ModelProvider]*schemas.ProviderConfig),
		keys:    make(map[schemas.ModelProvider][]schemas.Key),
	}
}

func NewStaticAccountFromAPIConfig(cfg *config.APIConfig) (*StaticAccount, error) {
	if cfg == nil {
		return nil, fmt.Errorf("api config is required")
	}

	account := NewStaticAccount()

	if strings.TrimSpace(cfg.OpenAIAPIKey) != "" {
		account.addProvider(schemas.OpenAI, openAIProviderConfig("", nil), providerKey("openai", cfg.OpenAIAPIKey))
	}

	if strings.TrimSpace(cfg.AnthropicAPIKey) != "" {
		account.addProvider(
			schemas.Anthropic,
			providerConfig(strings.TrimSpace(cfg.AnthropicAPIURL), nil, false),
			providerKey("anthropic", cfg.AnthropicAPIKey),
		)
	}

	if strings.TrimSpace(cfg.GoogleGeminiAPIKey) != "" {
		account.addProvider(
			schemas.ModelProvider("google"),
			providerConfig("", &schemas.CustomProviderConfig{BaseProviderType: schemas.Gemini}, false),
			providerKey("google", cfg.GoogleGeminiAPIKey),
		)
	}

	if strings.TrimSpace(cfg.InfomaniakAPIKey) != "" {
		baseURL, err := infomaniakBaseURL(cfg)
		if err != nil {
			return nil, err
		}
		account.addProvider(
			schemas.ModelProvider("infomaniak"),
			openAIProviderConfig(baseURL, &schemas.CustomProviderConfig{BaseProviderType: schemas.OpenAI}),
			providerKey("infomaniak", cfg.InfomaniakAPIKey),
		)
	}

	if strings.TrimSpace(cfg.CloudflareAPIKey) != "" {
		if strings.TrimSpace(cfg.CloudflareAccountID) == "" {
			return nil, fmt.Errorf("cloudflare.account_id is required when cloudflare.api_key is set")
		}
		account.addProvider(
			schemas.ModelProvider("cloudflare"),
			openAIProviderConfig(
				fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/ai/v1", strings.TrimSpace(cfg.CloudflareAccountID)),
				&schemas.CustomProviderConfig{BaseProviderType: schemas.OpenAI},
			),
			providerKey("cloudflare", cfg.CloudflareAPIKey),
		)
	}

	if strings.TrimSpace(cfg.DeepInfraAPIKey) != "" {
		baseURL := strings.TrimSpace(cfg.DeepInfraAPIURL)
		if baseURL == "" {
			baseURL = deepInfraDefaultURL
		}
		account.addProvider(
			schemas.ModelProvider("deepinfra"),
			openAIProviderConfig(baseURL, &schemas.CustomProviderConfig{BaseProviderType: schemas.OpenAI}),
			providerKey("deepinfra", cfg.DeepInfraAPIKey),
		)
	}

	if strings.TrimSpace(cfg.RequestyAPIKey) != "" {
		baseURL := strings.TrimSpace(cfg.RequestyAPIURL)
		if baseURL == "" {
			baseURL = requestyDefaultURL
		}
		account.addProvider(
			schemas.ModelProvider("requesty"),
			openAIProviderConfig(baseURL, &schemas.CustomProviderConfig{BaseProviderType: schemas.OpenAI}),
			providerKey("requesty", cfg.RequestyAPIKey),
		)
	}

	return account, nil
}

func (a *StaticAccount) GetConfiguredProviders() ([]schemas.ModelProvider, error) {
	providers := make([]schemas.ModelProvider, 0, len(a.configs))
	for provider := range a.configs {
		providers = append(providers, provider)
	}
	return providers, nil
}

func (a *StaticAccount) GetKeysForProvider(_ context.Context, provider schemas.ModelProvider) ([]schemas.Key, error) {
	keys, ok := a.keys[provider]
	if !ok {
		return nil, fmt.Errorf("provider %s is not configured", provider)
	}
	return cloneKeys(keys), nil
}

func (a *StaticAccount) GetConfigForProvider(provider schemas.ModelProvider) (*schemas.ProviderConfig, error) {
	cfg, ok := a.configs[provider]
	if !ok {
		return nil, fmt.Errorf("provider %s is not configured", provider)
	}
	cfgCopy := *cfg
	return &cfgCopy, nil
}

func (a *StaticAccount) addProvider(provider schemas.ModelProvider, cfg *schemas.ProviderConfig, key schemas.Key) {
	cfg.CheckAndSetDefaults()
	a.configs[provider] = cfg
	a.keys[provider] = []schemas.Key{key}
}

func openAIProviderConfig(baseURL string, custom *schemas.CustomProviderConfig) *schemas.ProviderConfig {
	cfg := providerConfig(baseURL, custom, true)
	cfg.OpenAIConfig = &schemas.OpenAIConfig{DisableStore: true}
	return cfg
}

func providerConfig(baseURL string, custom *schemas.CustomProviderConfig, openAICompatible bool) *schemas.ProviderConfig {
	cfg := &schemas.ProviderConfig{
		NetworkConfig: schemas.NetworkConfig{
			BaseURL:                        strings.TrimSpace(baseURL),
			DefaultRequestTimeoutInSeconds: schemas.DefaultRequestTimeoutInSeconds,
			MaxRetries:                     0,
			RetryBackoffInitial:            500 * time.Millisecond,
			RetryBackoffMax:                5 * time.Second,
			StreamIdleTimeoutInSeconds:     schemas.DefaultStreamIdleTimeoutInSeconds,
			MaxConnsPerHost:                schemas.DefaultMaxConnsPerHost,
		},
		ConcurrencyAndBufferSize: schemas.ConcurrencyAndBufferSize{
			Concurrency: 4,
			BufferSize:  32,
		},
		CustomProviderConfig: custom,
	}
	if openAICompatible {
		cfg.OpenAIConfig = &schemas.OpenAIConfig{DisableStore: true}
	}
	return cfg
}

func providerKey(id string, value string) schemas.Key {
	return schemas.Key{
		ID:     id + "-key",
		Name:   id + "-key",
		Value:  *schemas.NewEnvVar(strings.TrimSpace(value)),
		Models: schemas.WhiteList{"*"},
		Weight: defaultProviderWeight,
	}
}

func infomaniakBaseURL(cfg *config.APIConfig) (string, error) {
	if cfg == nil {
		return "", fmt.Errorf("api config is required")
	}
	if strings.TrimSpace(cfg.InfomaniakAPIURL) != "" {
		return strings.TrimSpace(cfg.InfomaniakAPIURL), nil
	}
	if strings.TrimSpace(cfg.InfomaniakProductID) == "" {
		return "", fmt.Errorf("infomaniak.product_id is required when infomaniak.api_key is set")
	}
	return fmt.Sprintf("https://api.infomaniak.com/2/ai/%s/openai", strings.TrimSpace(cfg.InfomaniakProductID)), nil
}

func cloneKeys(keys []schemas.Key) []schemas.Key {
	if len(keys) == 0 {
		return nil
	}
	cloned := make([]schemas.Key, len(keys))
	copy(cloned, keys)
	return cloned
}
