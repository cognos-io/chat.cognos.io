package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpdateReleaseImage(t *testing.T) {
	t.Parallel()

	input := `vars:
    cognos_release_image: ghcr.io/cognos-io/cognos-backend
    cognos_release_image_tag: placeholder
    cognos_release_image_digest: sha256:0000000000000000000000000000000000000000000000000000000000000000
`
	want := `vars:
    cognos_release_image: ghcr.io/cognos-io/cognos-backend
    cognos_release_image_tag: sha-0123456789012345678901234567890123456789
    cognos_release_image_digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`
	got, err := updateReleaseImage(
		[]byte(input),
		"sha-0123456789012345678901234567890123456789",
		"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	)
	if err != nil {
		t.Fatalf("updateReleaseImage() error = %v", err)
	}
	if string(got) != want {
		t.Errorf("updateReleaseImage() = %q, want %q", got, want)
	}
}

func TestUpdateReleaseImageRejectsMissingVariables(t *testing.T) {
	t.Parallel()

	_, err := updateReleaseImage([]byte("vars: {}\n"), "sha-0123456789012345678901234567890123456789", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err == nil {
		t.Error("updateReleaseImage() error = nil, want an error")
	}
}

func TestForgejoProviderCreatesPullRequest(t *testing.T) {
	t.Parallel()

	var createdBody string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if got := request.Header.Get("Authorization"); got != "token test-token" {
			t.Errorf("Authorization header = %q, want %q", got, "token test-token")
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
		token:         "test-token",
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
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if got := request.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("Authorization header = %q, want %q", got, "Bearer test-token")
		}
		switch {
		case request.Method == http.MethodGet:
			io.WriteString(response, `[{"number":7,"head":{"ref":"deploy/cognos-backend"}}]`)
		case request.Method == http.MethodPatch && request.URL.Path == "/repos/cognos-io/infrastructure/pulls/7":
			patched = true
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
		token:         "test-token",
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
}

func TestNewRepositoryProviderRejectsUnknownProvider(t *testing.T) {
	t.Parallel()

	_, err := newRepositoryProvider("gitlab", repositoryProviderConfig{}, http.DefaultClient)
	if err == nil {
		t.Error("newRepositoryProvider(\"gitlab\") error = nil, want an error")
	}
}
