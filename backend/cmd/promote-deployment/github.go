package main

import "net/http"

type githubProvider struct {
	*apiRepositoryProvider
}

func newGitHubProvider(cfg repositoryProviderConfig, client *http.Client) (*githubProvider, error) {
	provider, err := newAPIRepositoryProvider("github", "Bearer", cfg, client)
	if err != nil {
		return nil, err
	}
	return &githubProvider{apiRepositoryProvider: provider}, nil
}
