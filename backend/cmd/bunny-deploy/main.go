package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

// contentTypesByPath covers extensionless files Bunny would otherwise store as
// application/octet-stream. With nosniff on the edge, those would never run as
// HTML, so the W3C change-password meta-refresh must be uploaded as text/html.
var contentTypesByPath = map[string]string{
	".well-known/change-password": "text/html; charset=utf-8",
}

var (
	hashedAsset = regexp.MustCompile(`(?i)[.-][a-z0-9_-]{8,}\.(css|js|mjs|map|woff2?|png|jpe?g|gif|svg|webp|avif)$`)
	htmlFile    = regexp.MustCompile(`(?i)\.html$`)
	entryPoint  = regexp.MustCompile(`(^|/)index\.html$`)
)

type config struct {
	directory       string
	storageEndpoint string
	storageZone     string
	storageKey      string
	pullZoneID      string
	apiKey          string
}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Getenv, http.DefaultClient, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, getenv func(string) string, client *http.Client, stdout io.Writer) error {
	if len(args) != 1 {
		return errors.New("usage: bunny-deploy <build-directory>")
	}
	cfg, err := loadConfig(args[0], getenv)
	if err != nil {
		return err
	}
	return deploy(ctx, cfg, client, stdout)
}

func loadConfig(directory string, getenv func(string) string) (config, error) {
	endpoint := getenv("BUNNY_STORAGE_ENDPOINT")
	if endpoint == "" {
		endpoint = "https://storage.bunnycdn.com"
	}
	cfg := config{
		directory:       directory,
		storageEndpoint: endpoint,
		storageZone:     getenv("BUNNY_STORAGE_ZONE"),
		storageKey:      getenv("BUNNY_STORAGE_KEY"),
		pullZoneID:      getenv("BUNNY_PULL_ZONE_ID"),
		apiKey:          getenv("BUNNY_API_KEY"),
	}
	for name, value := range map[string]string{
		"BUNNY_STORAGE_ZONE": cfg.storageZone,
		"BUNNY_STORAGE_KEY":  cfg.storageKey,
		"BUNNY_PULL_ZONE_ID": cfg.pullZoneID,
		"BUNNY_API_KEY":      cfg.apiKey,
	} {
		if value == "" {
			return config{}, fmt.Errorf("%s must be set", name)
		}
	}
	return cfg, nil
}

func deploy(ctx context.Context, cfg config, client *http.Client, stdout io.Writer) error {
	files, err := deploymentFiles(cfg.directory)
	if err != nil {
		return err
	}
	for _, relativePath := range files {
		body, err := os.ReadFile(filepath.Join(cfg.directory, filepath.FromSlash(relativePath)))
		if err != nil {
			return fmt.Errorf("read %s: %w", relativePath, err)
		}
		digest := sha256.Sum256(body)
		headers := map[string]string{
			"AccessKey":    cfg.storageKey,
			"Checksum":     strings.ToUpper(hex.EncodeToString(digest[:])),
			"Content-Type": contentTypeFor(relativePath),
		}
		if err := requestWithRetry(ctx, client, http.MethodPut, storageURL(cfg.storageEndpoint, cfg.storageZone, relativePath), headers, body, http.StatusCreated); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "uploaded %s\n", relativePath)
	}
	purgeURL := "https://api.bunny.net/pullzone/" + url.PathEscape(cfg.pullZoneID) + "/purgeCache"
	if err := requestWithRetry(ctx, client, http.MethodPost, purgeURL, map[string]string{"AccessKey": cfg.apiKey}, nil, http.StatusNoContent); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "purged pull zone %s\n", cfg.pullZoneID)
	return nil
}

func deploymentFiles(root string) ([]string, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("inspect %s: %w", root, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", root)
	}
	var files []string
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relativePath, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(relativePath))
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk %s: %w", root, err)
	}
	if !slices.ContainsFunc(files, entryPoint.MatchString) {
		return nil, fmt.Errorf("%s contains no index.html entry point", root)
	}
	slices.SortFunc(files, compareDeploymentFiles)
	return files, nil
}

func compareDeploymentFiles(left, right string) int {
	rank := func(file string) int {
		if htmlFile.MatchString(file) {
			return 2
		}
		if hashedAsset.MatchString(file) {
			return 0
		}
		return 1
	}
	if difference := rank(left) - rank(right); difference != 0 {
		return difference
	}
	return strings.Compare(left, right)
}

func contentTypeFor(relativePath string) string {
	if contentType, ok := contentTypesByPath[filepath.ToSlash(relativePath)]; ok {
		return contentType
	}
	return "application/octet-stream"
}

func storageURL(endpoint, zone, relativePath string) string {
	segments := append([]string{zone}, strings.Split(relativePath, "/")...)
	for index := range segments {
		segments[index] = url.PathEscape(segments[index])
	}
	return strings.TrimRight(endpoint, "/") + "/" + strings.Join(segments, "/")
}

func requestWithRetry(ctx context.Context, client *http.Client, method, endpoint string, headers map[string]string, body []byte, expectedStatus int) error {
	var lastErr error
	for attempt := 1; attempt <= 4; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("create %s request: %w", method, err)
		}
		for name, value := range headers {
			req.Header.Set(name, value)
		}
		response, err := client.Do(req)
		if err == nil {
			detail, readErr := io.ReadAll(io.LimitReader(response.Body, 8<<10))
			closeErr := response.Body.Close()
			if readErr != nil {
				return fmt.Errorf("read %s response: %w", method, readErr)
			}
			if closeErr != nil {
				return fmt.Errorf("close %s response: %w", method, closeErr)
			}
			if response.StatusCode == expectedStatus {
				return nil
			}
			lastErr = fmt.Errorf("%s %s returned %d: %s", method, endpoint, response.StatusCode, detail)
			if response.StatusCode < 500 && response.StatusCode != http.StatusTooManyRequests {
				return lastErr
			}
		} else {
			lastErr = fmt.Errorf("%s %s: %w", method, endpoint, err)
		}
		if attempt < 4 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(1<<attempt) * 500 * time.Millisecond):
			}
		}
	}
	return lastErr
}
