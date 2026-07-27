package main

import (
	"strings"
	"testing"

	pbauth "github.com/pocketbase/pocketbase/tools/auth"
)

func TestConfigureE2EGoogleOAuth(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	originalFactory := pbauth.Providers[pbauth.NameGoogle]
	t.Cleanup(func() { pbauth.Providers[pbauth.NameGoogle] = originalFactory })

	const baseURL = "http://127.0.0.1:18085"
	if err := configureE2EGoogleOAuth(app, baseURL, true); err != nil {
		t.Fatal(err)
	}

	provider, err := pbauth.NewProviderByName(pbauth.NameGoogle)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := provider.AuthURL(), baseURL+"/oauth/google/authorize"; got != want {
		t.Fatalf("AuthURL = %q, want %q", got, want)
	}
	if got, want := provider.TokenURL(), baseURL+"/oauth/google/token"; got != want {
		t.Fatalf("TokenURL = %q, want %q", got, want)
	}
	if got, want := provider.UserInfoURL(), baseURL+"/oauth/google/userinfo"; got != want {
		t.Fatalf("UserInfoURL = %q, want %q", got, want)
	}

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	config, ok := users.OAuth2.GetProviderConfig(pbauth.NameGoogle)
	if !ok {
		t.Fatal("Google provider config missing from users collection")
	}
	if config.ClientId != "e2e-google-client" || config.ClientSecret == "" {
		t.Fatalf("unexpected E2E Google config: %+v", config)
	}
}

func TestConfigureE2EGoogleOAuthFailsClosed(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	for _, tc := range []struct {
		name    string
		baseURL string
		devMode bool
		want    string
	}{
		{
			name:    "disabled outside dev",
			baseURL: "http://127.0.0.1:18085",
			devMode: false,
			want:    "dev mode",
		},
		{
			name:    "rejects remote host",
			baseURL: "https://oauth.example.com",
			devMode: true,
			want:    "loopback",
		},
		{
			name:    "rejects credentials",
			baseURL: "http://user:pass@127.0.0.1:18085",
			devMode: true,
			want:    "credentials",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := configureE2EGoogleOAuth(app, tc.baseURL, tc.devMode)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want substring %q", err, tc.want)
			}
		})
	}
}
