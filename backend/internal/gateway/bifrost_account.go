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
	// requestyDefaultURL is Requesty's EU gateway. Pointing at this host keeps
	// Requesty's request processing zero-retention and in-region (Frankfurt);
	// full EU residency additionally requires EU-region model ids.
	//
	// NB: no "/v1" suffix — Bifrost's OpenAI provider appends "/v1/chat/completions"
	// to the base URL itself, so including it here would produce a doubled
	// "/v1/v1/..." path and a 404 from Requesty.
	requestyDefaultURL = "https://router.eu.requesty.ai"
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

	if strings.TrimSpace(cfg.InfomaniakAPIKey) != "" {
		baseURL, err := infomaniakBaseURL(cfg)
		if err != nil {
			return nil, err
		}
		account.addProvider(
			schemas.ModelProvider("infomaniak"),
			// Infomaniak speaks only Chat Completions, so gate the custom provider
			// to the chat operations. Bifrost then transparently translates our
			// Responses API calls into Chat Completions for Infomaniak (its
			// shouldFallbackResponsesToChat path), letting the gateway drive every
			// provider through a single Responses code path. Requesty (below) is
			// left ungated so it uses the native Responses API.
			openAIProviderConfig(baseURL, &schemas.CustomProviderConfig{
				BaseProviderType: schemas.OpenAI,
				AllowedRequests: &schemas.AllowedRequests{
					ChatCompletion:       true,
					ChatCompletionStream: true,
				},
			}),
			providerKey("infomaniak", cfg.InfomaniakAPIKey),
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

// openAIProviderConfig builds the Bifrost config for an OpenAI-compatible
// provider. DisableStore is always set so upstreams never persist our prompts.
func openAIProviderConfig(baseURL string, custom *schemas.CustomProviderConfig) *schemas.ProviderConfig {
	return &schemas.ProviderConfig{
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
		OpenAIConfig:         &schemas.OpenAIConfig{DisableStore: true},
	}
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
