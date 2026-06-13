package main

import (
	"context"
	"errors"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/maximhq/bifrost/core/schemas"
)

type staticCatalogueService struct {
	model catalogue.Model
	err   error
}

func (s staticCatalogueService) ActiveModels(context.Context) ([]catalogue.Model, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.model.ID == "" {
		s.model = catalogue.Model{ID: "llama-3-3-infomaniak", ProviderID: "infomaniak", NoRetention: true, IsActive: true}
	}
	return []catalogue.Model{s.model}, nil
}

func (s staticCatalogueService) GetModelByID(context.Context, string) (catalogue.Model, bool, error) {
	return catalogue.Model{}, false, nil
}

func (s staticCatalogueService) Invalidate() {}

type staticAccount struct {
	configErr error
	keysErr   error
	config    *schemas.ProviderConfig
	keys      []schemas.Key
}

func (a staticAccount) GetConfiguredProviders() ([]schemas.ModelProvider, error) {
	return nil, nil
}

func (a staticAccount) GetConfigForProvider(schemas.ModelProvider) (*schemas.ProviderConfig, error) {
	if a.configErr != nil {
		return nil, a.configErr
	}
	if a.config != nil {
		return a.config, nil
	}
	return &schemas.ProviderConfig{OpenAIConfig: &schemas.OpenAIConfig{DisableStore: true}}, nil
}

func (a staticAccount) GetKeysForProvider(context.Context, schemas.ModelProvider) ([]schemas.Key, error) {
	if a.keysErr != nil {
		return nil, a.keysErr
	}
	if a.keys != nil {
		return a.keys, nil
	}
	return []schemas.Key{{ID: "test-key"}}, nil
}

func TestEnsureActiveProvidersConfigured(t *testing.T) {
	t.Parallel()

	if err := ensureActiveProvidersConfigured(context.Background(), staticCatalogueService{}, staticAccount{}); err != nil {
		t.Fatalf("ensureActiveProvidersConfigured() error = %v, want nil", err)
	}
}

func TestEnsureActiveProvidersConfiguredReturnsProviderError(t *testing.T) {
	t.Parallel()

	wantErr := errors.New("provider unavailable")
	if err := ensureActiveProvidersConfigured(context.Background(), staticCatalogueService{}, staticAccount{configErr: wantErr}); !errors.Is(err, wantErr) {
		t.Fatalf("ensureActiveProvidersConfigured() error = %v, want wrapped %v", err, wantErr)
	}
}

func TestEnsureActiveProvidersConfiguredReturnsMissingKeysError(t *testing.T) {
	t.Parallel()

	wantErr := errors.New("missing keys")
	if err := ensureActiveProvidersConfigured(context.Background(), staticCatalogueService{}, staticAccount{keysErr: wantErr}); !errors.Is(err, wantErr) {
		t.Fatalf("ensureActiveProvidersConfigured() error = %v, want wrapped %v", err, wantErr)
	}
}

func TestEnsureActiveProvidersConfiguredRejectsOpenAIStorageForNoRetentionModels(t *testing.T) {
	t.Parallel()

	err := ensureActiveProvidersConfigured(
		context.Background(),
		staticCatalogueService{},
		staticAccount{config: &schemas.ProviderConfig{OpenAIConfig: &schemas.OpenAIConfig{DisableStore: false}}},
	)
	if err == nil {
		t.Fatal("ensureActiveProvidersConfigured() error = nil, want non-nil")
	}
}
