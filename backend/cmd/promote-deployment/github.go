package main

import (
	"context"
	"errors"
	"net/http"
	"strconv"
)

const githubPullRequestAssignee = "kisamoto"

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

func (provider *githubProvider) UpsertPullRequest(ctx context.Context, branch string, pull pullRequest) error {
	number, err := provider.upsertPullRequest(ctx, branch, pull)
	if err != nil {
		return err
	}
	endpoint := provider.apiURL + "/repos/" + provider.repository + "/issues/" + strconv.Itoa(number) + "/assignees"
	payload := map[string][]string{"assignees": {githubPullRequestAssignee}}
	return provider.request(ctx, http.MethodPost, endpoint, payload, nil)
}
