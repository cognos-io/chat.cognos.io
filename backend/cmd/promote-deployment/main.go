package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	imageTagPattern    = regexp.MustCompile(`^sha-[0-9a-f]{40}$`)
	imageDigestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	tagLinePattern     = regexp.MustCompile(`(?m)^    cognos_release_image_tag:.*$`)
	digestLinePattern  = regexp.MustCompile(`(?m)^    cognos_release_image_digest:.*$`)
)

type config struct {
	provider    repositoryProvider
	branch      string
	imageTag    string
	imageDigest string
	sourceSHA   string
	sourceURL   string
	buildURL    string
}

func main() {
	if err := run(context.Background(), os.Getenv, http.DefaultClient, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, getenv func(string) string, client *http.Client, stdout io.Writer) error {
	cfg, err := loadConfig(getenv, client)
	if err != nil {
		return err
	}
	directory, err := os.MkdirTemp("", "cognos-infrastructure-")
	if err != nil {
		return fmt.Errorf("create temporary directory: %w", err)
	}
	defer os.RemoveAll(directory)

	if err := cfg.provider.Clone(ctx, directory); err != nil {
		return err
	}
	playbook := filepath.Join(directory, "playbooks", "app_servers.yml")
	contents, err := os.ReadFile(playbook)
	if err != nil {
		return fmt.Errorf("read application playbook: %w", err)
	}
	updated, err := updateReleaseImage(contents, cfg.imageTag, cfg.imageDigest)
	if err != nil {
		return err
	}
	if bytes.Equal(contents, updated) {
		fmt.Fprintln(stdout, "infrastructure repository already references this image")
		return nil
	}
	if err := os.WriteFile(playbook, updated, 0o644); err != nil {
		return fmt.Errorf("write application playbook: %w", err)
	}

	shortSHA := cfg.sourceSHA[:12]
	commands := [][]string{
		{"diff", "--check"},
		{"config", "user.name", "cognos deployment bot"},
		{"config", "user.email", "deployment-bot@cognos.io"},
		{"switch", "--create", cfg.branch},
		{"add", "playbooks/app_servers.yml"},
		{"commit", "-m", "chore(cognos): promote backend " + shortSHA},
	}
	for _, arguments := range commands {
		if err := runGit(ctx, directory, arguments...); err != nil {
			return err
		}
	}
	if err := cfg.provider.Push(ctx, directory, cfg.branch); err != nil {
		return err
	}

	pull := pullRequest{
		title: "chore(cognos): promote backend " + shortSHA,
		body: strings.Join([]string{
			"Automated Cognos backend promotion.",
			"",
			"- Source: " + cfg.sourceURL,
			"- Image tag: `" + cfg.imageTag + "`",
			"- Image digest: `" + cfg.imageDigest + "`",
			"- Build: " + cfg.buildURL,
			"",
			"Merging this pull request authorises the infrastructure repository to deploy this exact image.",
		}, "\n"),
	}
	if err := cfg.provider.UpsertPullRequest(ctx, cfg.branch, pull); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "promoted %s at %s\n", cfg.imageTag, cfg.imageDigest)
	return nil
}

func loadConfig(getenv func(string) string, client *http.Client) (config, error) {
	providerName := getenv("INFRASTRUCTURE_PROVIDER")
	if providerName == "" {
		providerName = "github"
	}
	prefix := strings.ToUpper(providerName) + "_INFRASTRUCTURE_"
	providerCfg := repositoryProviderConfig{
		apiURL:        strings.TrimRight(getenv(prefix+"API_URL"), "/"),
		repository:    getenv(prefix + "REPOSITORY"),
		repositoryURL: getenv(prefix + "REPOSITORY_URL"),
		token:         getenv(prefix + "TOKEN"),
	}
	if providerName == "github" && providerCfg.apiURL == "" {
		providerCfg.apiURL = "https://api.github.com"
	}
	provider, err := newRepositoryProvider(providerName, providerCfg, client)
	if err != nil {
		return config{}, err
	}
	repository := getenv("GITHUB_REPOSITORY")
	serverURL := strings.TrimRight(getenv("GITHUB_SERVER_URL"), "/")
	sha := getenv("GITHUB_SHA")
	runID := getenv("GITHUB_RUN_ID")
	cfg := config{
		provider:    provider,
		branch:      getenv("INFRASTRUCTURE_BRANCH"),
		imageTag:    getenv("IMAGE_TAG"),
		imageDigest: getenv("IMAGE_DIGEST"),
		sourceSHA:   sha,
		sourceURL:   serverURL + "/" + repository + "/commit/" + sha,
		buildURL:    serverURL + "/" + repository + "/actions/runs/" + runID,
	}
	for name, value := range map[string]string{
		prefix + "REPOSITORY":     providerCfg.repository,
		prefix + "REPOSITORY_URL": providerCfg.repositoryURL,
		prefix + "TOKEN":          providerCfg.token,
		"GITHUB_REPOSITORY":       repository,
		"GITHUB_RUN_ID":           runID,
		"GITHUB_SERVER_URL":       serverURL,
		"GITHUB_SHA":              sha,
		"IMAGE_DIGEST":            cfg.imageDigest,
		"IMAGE_TAG":               cfg.imageTag,
		"INFRASTRUCTURE_BRANCH":   cfg.branch,
	} {
		if value == "" {
			return config{}, fmt.Errorf("%s must be set", name)
		}
	}
	if !imageTagPattern.MatchString(cfg.imageTag) {
		return config{}, errors.New("IMAGE_TAG must have the form sha-<40 lowercase hexadecimal characters>")
	}
	if !imageDigestPattern.MatchString(cfg.imageDigest) {
		return config{}, errors.New("IMAGE_DIGEST must have the form sha256:<64 lowercase hexadecimal characters>")
	}
	return cfg, nil
}

func updateReleaseImage(contents []byte, tag, digest string) ([]byte, error) {
	if matches := tagLinePattern.FindAll(contents, -1); len(matches) != 1 {
		return nil, fmt.Errorf("application playbook contains %d Cognos image tag variables, want 1", len(matches))
	}
	if matches := digestLinePattern.FindAll(contents, -1); len(matches) != 1 {
		return nil, fmt.Errorf("application playbook contains %d Cognos image digest variables, want 1", len(matches))
	}
	updated := tagLinePattern.ReplaceAll(contents, []byte("    cognos_release_image_tag: "+tag))
	updated = digestLinePattern.ReplaceAll(updated, []byte("    cognos_release_image_digest: "+digest))
	return updated, nil
}
