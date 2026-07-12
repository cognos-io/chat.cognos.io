package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
)

type repositoryProvider interface {
	Clone(context.Context, string) error
	Push(context.Context, string, string) error
	UpsertPullRequest(context.Context, string, pullRequest) error
}

type repositoryProviderConfig struct {
	apiURL        string
	repository    string
	repositoryURL string
	token         string
}

type pullRequest struct {
	title string
	body  string
}

type apiRepositoryProvider struct {
	name          string
	apiURL        string
	repository    string
	repositoryURL string
	token         string
	authScheme    string
	client        *http.Client
}

func newRepositoryProvider(name string, cfg repositoryProviderConfig, client *http.Client) (repositoryProvider, error) {
	switch name {
	case "github":
		return newGitHubProvider(cfg, client)
	case "forgejo":
		return newForgejoProvider(cfg, client)
	default:
		return nil, fmt.Errorf("unsupported infrastructure provider %q; want github or forgejo", name)
	}
}

func newAPIRepositoryProvider(name, authScheme string, cfg repositoryProviderConfig, client *http.Client) (*apiRepositoryProvider, error) {
	parts := strings.Split(cfg.repository, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil, fmt.Errorf("%s infrastructure repository must have the form owner/repository", name)
	}
	return &apiRepositoryProvider{
		name:          name,
		apiURL:        cfg.apiURL,
		repository:    cfg.repository,
		repositoryURL: cfg.repositoryURL,
		token:         cfg.token,
		authScheme:    authScheme,
		client:        client,
	}, nil
}

func (provider *apiRepositoryProvider) Clone(ctx context.Context, directory string) error {
	return runGit(ctx, "", "-c", "http.extraHeader="+provider.authorizationHeader(), "clone", "--branch", "main", "--single-branch", provider.repositoryURL, directory)
}

func (provider *apiRepositoryProvider) Push(ctx context.Context, directory, branch string) error {
	return runGit(ctx, directory, "-c", "http.extraHeader="+provider.authorizationHeader(), "push", "--force", "origin", branch)
}

func (provider *apiRepositoryProvider) UpsertPullRequest(ctx context.Context, branch string, pull pullRequest) error {
	parts := strings.Split(provider.repository, "/")
	endpoint := provider.apiURL + "/repos/" + parts[0] + "/" + parts[1] + "/pulls"
	var existing []struct {
		Number int `json:"number"`
		Head   struct {
			Ref string `json:"ref"`
		} `json:"head"`
	}
	if err := provider.request(ctx, http.MethodGet, endpoint+"?state=open&limit=50", nil, &existing); err != nil {
		return err
	}
	for _, candidate := range existing {
		if candidate.Head.Ref == branch {
			payload := map[string]string{"title": pull.title, "body": pull.body}
			return provider.request(ctx, http.MethodPatch, endpoint+"/"+strconv.Itoa(candidate.Number), payload, nil)
		}
	}
	payload := map[string]string{"title": pull.title, "body": pull.body, "head": branch, "base": "main"}
	return provider.request(ctx, http.MethodPost, endpoint, payload, nil)
}

func (provider *apiRepositoryProvider) request(ctx context.Context, method, endpoint string, payload, result any) error {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode %s request: %w", provider.name, err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return fmt.Errorf("create %s request: %w", provider.name, err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", provider.authScheme+" "+provider.token)
	request.Header.Set("Content-Type", "application/json")
	response, err := provider.client.Do(request)
	if err != nil {
		return fmt.Errorf("send %s request: %w", provider.name, err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 32<<10))
	if err != nil {
		return fmt.Errorf("read %s response: %w", provider.name, err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("%s API returned %s: %s", provider.name, response.Status, strings.TrimSpace(string(responseBody)))
	}
	if result != nil && len(responseBody) > 0 {
		if err := json.Unmarshal(responseBody, result); err != nil {
			return fmt.Errorf("decode %s response: %w", provider.name, err)
		}
	}
	return nil
}

func (provider *apiRepositoryProvider) authorizationHeader() string {
	return "Authorization: " + provider.authScheme + " " + provider.token
}

func runGit(ctx context.Context, directory string, arguments ...string) error {
	if len(arguments) == 0 {
		return errors.New("git command requires arguments")
	}
	command := exec.CommandContext(ctx, "git", arguments...)
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %s: %w: %s", arguments[0], err, strings.TrimSpace(string(output)))
	}
	return nil
}
