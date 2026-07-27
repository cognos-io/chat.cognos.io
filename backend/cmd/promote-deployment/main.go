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

	"go.yaml.in/yaml/v3"
)

var (
	imageTagPattern    = regexp.MustCompile(`^sha-[0-9a-f]{40}$`)
	imageDigestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
)

const (
	applicationName = "cognos"
	imageRepository = "ghcr.io/cognos-io/cognos-backend"
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
	manifest := filepath.Join(directory, "applications.yml")
	// #nosec G304 -- manifest is a fixed path inside the freshly cloned repository.
	contents, err := os.ReadFile(manifest)
	if err != nil {
		return fmt.Errorf("read application manifest: %w", err)
	}
	updated, err := updateReleaseImage(contents, cfg.imageTag, cfg.imageDigest)
	if err != nil {
		return err
	}
	if bytes.Equal(contents, updated) {
		fmt.Fprintln(stdout, "infrastructure repository already references this image")
		return nil
	}
	// #nosec G306,G703 -- fixed tracked file inside the freshly cloned repository.
	if err := os.WriteFile(manifest, updated, 0o644); err != nil {
		return fmt.Errorf("write application manifest: %w", err)
	}

	shortSHA := cfg.sourceSHA[:12]
	commands := [][]string{
		{"diff", "--check"},
		{"config", "user.name", "cognos deployment bot"},
		{"config", "user.email", "deployment-bot@cognos.io"},
		{"switch", "--create", cfg.branch},
		{"add", "applications.yml"},
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
		username:      getenv(prefix + "USERNAME"),
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
	var document yaml.Node
	if err := yaml.Unmarshal(contents, &document); err != nil {
		return nil, fmt.Errorf("parse application manifest: %w", err)
	}
	if len(document.Content) != 1 {
		return nil, errors.New("application manifest must contain one YAML document")
	}

	applications, err := mappingValue(document.Content[0], "braw_applications")
	if err != nil {
		return nil, err
	}
	if applications.Kind != yaml.SequenceNode {
		return nil, errors.New("braw_applications must be a sequence")
	}

	matches := make([]*yaml.Node, 0, 1)
	for _, candidate := range applications.Content {
		name, lookupErr := mappingValue(candidate, "name")
		if lookupErr == nil && name.Value == applicationName {
			matches = append(matches, candidate)
		}
	}
	if len(matches) != 1 {
		return nil, fmt.Errorf("application manifest contains %d %s applications, want 1", len(matches), applicationName)
	}

	releaseImage, err := mappingValue(matches[0], "release_image")
	if err != nil {
		return nil, err
	}
	reference, err := mappingValue(releaseImage, "reference")
	if err != nil {
		return nil, err
	}
	if reference.Kind != yaml.ScalarNode {
		return nil, errors.New("release_image.reference must be a scalar")
	}
	reference.Value = imageRepository + ":" + tag + "@" + digest

	var updated bytes.Buffer
	if bytes.HasPrefix(contents, []byte("---\n")) {
		updated.WriteString("---\n")
	}
	encoder := yaml.NewEncoder(&updated)
	encoder.SetIndent(2)
	if err := encoder.Encode(&document); err != nil {
		return nil, fmt.Errorf("encode application manifest: %w", err)
	}
	if err := encoder.Close(); err != nil {
		return nil, fmt.Errorf("close application manifest encoder: %w", err)
	}
	return updated.Bytes(), nil
}

func mappingValue(mapping *yaml.Node, key string) (*yaml.Node, error) {
	if mapping.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("%s parent must be a mapping", key)
	}
	for index := 0; index < len(mapping.Content); index += 2 {
		if mapping.Content[index].Value == key {
			return mapping.Content[index+1], nil
		}
	}
	return nil, fmt.Errorf("application manifest is missing %s", key)
}
