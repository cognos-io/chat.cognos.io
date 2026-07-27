package main

import (
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	pbauth "github.com/pocketbase/pocketbase/tools/auth"
)

const e2eGoogleOAuthURLEnv = "COGNOS_E2E_GOOGLE_OAUTH_URL"

// configureE2EGoogleOAuth replaces PocketBase's Google endpoints with a
// deterministic loopback identity service. It is an E2E seam, never a
// production authentication path: non-dev mode and non-loopback URLs fail
// closed.
func configureE2EGoogleOAuth(app core.App, rawBaseURL string, devMode bool) error {
	if rawBaseURL == "" {
		return nil
	}
	if !devMode {
		return fmt.Errorf("%s is available only in dev mode", e2eGoogleOAuthURLEnv)
	}

	baseURL, err := url.Parse(rawBaseURL)
	if err != nil {
		return fmt.Errorf("parse %s: %w", e2eGoogleOAuthURLEnv, err)
	}
	if baseURL.Scheme != "http" && baseURL.Scheme != "https" {
		return fmt.Errorf("%s must use http or https", e2eGoogleOAuthURLEnv)
	}
	if baseURL.User != nil {
		return fmt.Errorf("%s must not contain credentials", e2eGoogleOAuthURLEnv)
	}
	if baseURL.RawQuery != "" || baseURL.Fragment != "" || (baseURL.Path != "" && baseURL.Path != "/") {
		return fmt.Errorf("%s must be an origin without a path, query, or fragment", e2eGoogleOAuthURLEnv)
	}
	host := baseURL.Hostname()
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("%s must point to a loopback host", e2eGoogleOAuthURLEnv)
	}
	origin := strings.TrimRight(baseURL.String(), "/")

	pbauth.Providers[pbauth.NameGoogle] = func() pbauth.Provider {
		provider := pbauth.NewGoogleProvider()
		provider.SetAuthURL(origin + "/oauth/google/authorize")
		provider.SetTokenURL(origin + "/oauth/google/token")
		provider.SetUserInfoURL(origin + "/oauth/google/userinfo")
		return provider
	}

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return fmt.Errorf("load users collection for E2E Google OAuth: %w", err)
	}
	providers := make([]core.OAuth2ProviderConfig, 0, len(users.OAuth2.Providers)+1)
	for _, provider := range users.OAuth2.Providers {
		if provider.Name != pbauth.NameGoogle {
			providers = append(providers, provider)
		}
	}
	providers = append(providers, core.OAuth2ProviderConfig{
		Name:         pbauth.NameGoogle,
		ClientId:     "e2e-google-client",
		ClientSecret: "e2e-google-secret", // gitleaks:allow
	})
	users.OAuth2.Enabled = true
	users.OAuth2.Providers = providers
	if err := app.Save(users); err != nil {
		return fmt.Errorf("save E2E Google OAuth config: %w", err)
	}
	return nil
}
