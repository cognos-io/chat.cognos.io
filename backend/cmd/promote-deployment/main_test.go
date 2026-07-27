package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestUpdateReleaseImageFromInfrastructureManifest(t *testing.T) {
	t.Parallel()

	input, err := os.ReadFile("testdata/applications.yml")
	if err != nil {
		t.Fatalf("ReadFile(testdata/applications.yml) error = %v", err)
	}
	currentReference := []byte("ghcr.io/cognos-io/cognos-backend:sha-5034c046f53f7735b2cee8c7c42ce0516789e512@sha256:987be61a5a06be0711185fd4ffcea5537e89298bee931993bb248933b069d5e5")
	wantReference := []byte("ghcr.io/cognos-io/cognos-backend:sha-0123456789012345678901234567890123456789@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if occurrences := bytes.Count(input, currentReference); occurrences != 1 {
		t.Fatalf("fixture contains %d current image references, want 1", occurrences)
	}
	want := bytes.Replace(input, currentReference, wantReference, 1)

	got, err := updateReleaseImage(
		input,
		"sha-0123456789012345678901234567890123456789",
		"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	)
	if err != nil {
		t.Fatalf("updateReleaseImage() error = %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("updateReleaseImage() = %q, want %q", got, want)
	}
}

func TestUpdateReleaseImageRejectsMissingCognosApplication(t *testing.T) {
	t.Parallel()

	_, err := updateReleaseImage([]byte("braw_applications: []\n"), "sha-0123456789012345678901234567890123456789", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err == nil {
		t.Error("updateReleaseImage() error = nil, want an error")
	}
}

func TestUpdateReleaseImageRejectsMalformedManifest(t *testing.T) {
	t.Parallel()

	_, err := updateReleaseImage([]byte("braw_applications: [\n"), "sha-0123456789012345678901234567890123456789", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err == nil {
		t.Error("updateReleaseImage() error = nil, want an error")
	}
}

func TestUpdateReleaseImageRejectsDuplicateCognosApplications(t *testing.T) {
	t.Parallel()

	input := `braw_applications:
  - name: cognos
    release_image:
      reference: ghcr.io/cognos-io/cognos-backend:old@sha256:0000000000000000000000000000000000000000000000000000000000000000
  - name: cognos
    release_image:
      reference: ghcr.io/cognos-io/cognos-backend:old@sha256:0000000000000000000000000000000000000000000000000000000000000000
`
	_, err := updateReleaseImage([]byte(input), "sha-0123456789012345678901234567890123456789", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err == nil {
		t.Error("updateReleaseImage() error = nil, want an error")
	}
}

func TestForgejoProviderCreatesPullRequest(t *testing.T) {
	t.Parallel()

	var createdBody string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if got := request.Header.Get("Authorization"); got != "token token" {
			t.Errorf("Authorization header = %q, want %q", got, "token token")
		}
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/repos/braw.dev/infrastructure/pulls":
			io.WriteString(response, `[]`)
		case request.Method == http.MethodPost && request.URL.Path == "/repos/braw.dev/infrastructure/pulls":
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Errorf("ReadAll(request.Body) error = %v", err)
			}
			createdBody = string(body)
			response.WriteHeader(http.StatusCreated)
			io.WriteString(response, `{"number":42}`)
		default:
			http.Error(response, "unexpected request", http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)

	provider, err := newForgejoProvider(repositoryProviderConfig{
		apiURL:        server.URL,
		repository:    "braw.dev/infrastructure",
		repositoryURL: server.URL + "/braw.dev/infrastructure.git",
		token:         "token",
	}, server.Client())
	if err != nil {
		t.Fatalf("newForgejoProvider() error = %v", err)
	}
	err = provider.UpsertPullRequest(context.Background(), "deploy/cognos-backend", pullRequest{title: "promote", body: "details"})
	if err != nil {
		t.Fatalf("ForgejoProvider.UpsertPullRequest() error = %v", err)
	}
	for _, fragment := range []string{`"title":"promote"`, `"head":"deploy/cognos-backend"`, `"base":"main"`} {
		if !strings.Contains(createdBody, fragment) {
			t.Errorf("created pull request body %q does not contain %q", createdBody, fragment)
		}
	}
}

func TestGitHubProviderUpdatesExistingPullRequest(t *testing.T) {
	t.Parallel()

	var patched bool
	var assignedBody string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if got := request.Header.Get("Authorization"); got != "Bearer token" {
			t.Errorf("Authorization header = %q, want %q", got, "Bearer token")
		}
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/repos/cognos-io/infrastructure/pulls":
			io.WriteString(response, `[{"number":7,"head":{"ref":"deploy/cognos-backend"}}]`)
		case request.Method == http.MethodPatch && request.URL.Path == "/repos/cognos-io/infrastructure/pulls/7":
			patched = true
			io.WriteString(response, `{"number":7}`)
		case request.Method == http.MethodPost && request.URL.Path == "/repos/cognos-io/infrastructure/issues/7/assignees":
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Errorf("ReadAll(request.Body) error = %v", err)
			}
			assignedBody = string(body)
			response.WriteHeader(http.StatusCreated)
			io.WriteString(response, `{"number":7}`)
		default:
			http.Error(response, "unexpected request", http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)

	provider, err := newGitHubProvider(repositoryProviderConfig{
		apiURL:        server.URL,
		repository:    "cognos-io/infrastructure",
		repositoryURL: server.URL + "/cognos-io/infrastructure.git",
		token:         "token",
		username:      "deployment-bot",
	}, server.Client())
	if err != nil {
		t.Fatalf("newGitHubProvider() error = %v", err)
	}
	err = provider.UpsertPullRequest(context.Background(), "deploy/cognos-backend", pullRequest{title: "promote", body: "details"})
	if err != nil {
		t.Fatalf("GitHubProvider.UpsertPullRequest() error = %v", err)
	}
	if !patched {
		t.Error("upsertPullRequest() patched = false, want true")
	}
	if !strings.Contains(assignedBody, `"assignees":["kisamoto"]`) {
		t.Errorf("UpsertPullRequest() assignment body = %q, want assignee kisamoto", assignedBody)
	}
}

func TestGitHubProviderCreatesAndAssignsPullRequest(t *testing.T) {
	t.Parallel()

	var assigned bool
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/repos/braw-dev/infra/pulls":
			io.WriteString(response, `[]`)
		case request.Method == http.MethodPost && request.URL.Path == "/repos/braw-dev/infra/pulls":
			response.WriteHeader(http.StatusCreated)
			io.WriteString(response, `{"number":42}`)
		case request.Method == http.MethodPost && request.URL.Path == "/repos/braw-dev/infra/issues/42/assignees":
			assigned = true
			response.WriteHeader(http.StatusCreated)
			io.WriteString(response, `{"number":42}`)
		default:
			http.Error(response, "unexpected request", http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)

	provider, err := newGitHubProvider(repositoryProviderConfig{
		apiURL:        server.URL,
		repository:    "braw-dev/infra",
		repositoryURL: server.URL + "/braw-dev/infra.git",
		token:         "token",
		username:      "deployment-bot",
	}, server.Client())
	if err != nil {
		t.Fatalf("newGitHubProvider() error = %v", err)
	}
	err = provider.UpsertPullRequest(context.Background(), "deploy/cognos-backend", pullRequest{title: "promote", body: "details"})
	if err != nil {
		t.Fatalf("GitHubProvider.UpsertPullRequest() error = %v", err)
	}
	if !assigned {
		t.Error("UpsertPullRequest() assigned = false, want true")
	}
}

func TestGitHubProviderUsesBasicAuthenticationForGit(t *testing.T) {
	t.Parallel()

	environment := map[string]string{
		"GITHUB_INFRASTRUCTURE_REPOSITORY":     "braw-dev/infra",
		"GITHUB_INFRASTRUCTURE_REPOSITORY_URL": "https://github.com/braw-dev/infra.git",
		"GITHUB_INFRASTRUCTURE_TOKEN":          "token",
		"GITHUB_INFRASTRUCTURE_USERNAME":       "deployment-bot",
		"GITHUB_REPOSITORY":                    "cognos-io/chat.cognos.io",
		"GITHUB_RUN_ID":                        "1234",
		"GITHUB_SERVER_URL":                    "https://github.com",
		"GITHUB_SHA":                           "0123456789012345678901234567890123456789",
		"IMAGE_DIGEST":                         "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"IMAGE_TAG":                            "sha-0123456789012345678901234567890123456789",
		"INFRASTRUCTURE_BRANCH":                "deploy/cognos-backend",
		"INFRASTRUCTURE_PROVIDER":              "github",
	}
	cfg, err := loadConfig(func(name string) string {
		return environment[name]
	}, http.DefaultClient)
	if err != nil {
		t.Fatalf("loadConfig() error = %v", err)
	}
	provider, ok := cfg.provider.(*githubProvider)
	if !ok {
		t.Fatalf("loadConfig() provider = %T, want *githubProvider", cfg.provider)
	}

	credentials := base64.StdEncoding.EncodeToString([]byte("deployment-bot:token"))
	want := "Authorization: Basic " + credentials
	if got := provider.gitAuthorizationHeader(); got != want {
		t.Errorf("gitAuthorizationHeader() = %q, want %q", got, want)
	}
}

func TestGitHubProviderRejectsMissingUsername(t *testing.T) {
	t.Parallel()

	_, err := newGitHubProvider(repositoryProviderConfig{
		apiURL:        "https://api.github.com",
		repository:    "braw-dev/infra",
		repositoryURL: "https://github.com/braw-dev/infra.git",
		token:         "token",
	}, http.DefaultClient)
	if err == nil {
		t.Error("newGitHubProvider() error = nil, want an error for a missing username")
	}
}

func TestNewRepositoryProviderRejectsUnknownProvider(t *testing.T) {
	t.Parallel()

	_, err := newRepositoryProvider("gitlab", repositoryProviderConfig{}, http.DefaultClient)
	if err == nil {
		t.Error("newRepositoryProvider(\"gitlab\") error = nil, want an error")
	}
}
