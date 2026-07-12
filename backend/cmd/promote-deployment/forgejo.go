package main

import "net/http"

type forgejoProvider struct {
	*apiRepositoryProvider
}

func newForgejoProvider(cfg repositoryProviderConfig, client *http.Client) (*forgejoProvider, error) {
	provider, err := newAPIRepositoryProvider("forgejo", "token", cfg, client)
	if err != nil {
		return nil, err
	}
	return &forgejoProvider{apiRepositoryProvider: provider}, nil
}
