package main

import (
	"errors"
	"net/http"
)

type githubProvider struct {
	*apiRepositoryProvider
}

func newGitHubProvider(cfg repositoryProviderConfig, client *http.Client) (*githubProvider, error) {
	if cfg.username == "" {
		return nil, errors.New("GITHUB_INFRASTRUCTURE_USERNAME must be set")
	}
	provider, err := newAPIRepositoryProvider("github", "Bearer", cfg, client)
	if err != nil {
		return nil, err
	}
	return &githubProvider{apiRepositoryProvider: provider}, nil
}
