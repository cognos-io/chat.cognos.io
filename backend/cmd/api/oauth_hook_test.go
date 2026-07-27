package main

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	cognosoauth "github.com/cognos-io/chat.cognos.io/backend/internal/oauth"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/auth"
	"golang.org/x/oauth2"
)

var _ auth.Provider = (*fakeOAuthProvider)(nil)

type fakeOAuthProvider struct {
	auth.BaseProvider

	authUser *auth.AuthUser
}

func (p *fakeOAuthProvider) FetchToken(string, ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	return &oauth2.Token{AccessToken: "test-access-token"}, nil
}

func (p *fakeOAuthProvider) FetchAuthUser(*oauth2.Token) (*auth.AuthUser, error) {
	return p.authUser, nil
}

func TestOAuthHookStepUpRequiresExactGoogleIdentity(t *testing.T) {
	const (
		email            = "test1@example.com"
		linkedProviderID = "google-linked-id"
	)

	t.Run("exact linked identity confirms challenge", func(t *testing.T) {
		app := setupOAuthHookTestApp(t, cognosoauth.ProviderGoogle, &auth.AuthUser{
			Id:    linkedProviderID,
			Email: email,
		})
		user := mustOAuthHookUser(t, app, email)
		saveExternalAuth(t, app, user, cognosoauth.ProviderGoogle, linkedProviderID)

		store := cognosoauth.NewStore(app)
		challenge, err := store.CreateStepUpChallenge(user.Id, cognosoauth.ProviderGoogle)
		if err != nil {
			t.Fatalf("CreateStepUpChallenge(%q, %q) error = %v", user.Id, cognosoauth.ProviderGoogle, err)
		}

		scenario := tests.ApiScenario{
			Name:   "exact linked Google identity",
			Method: http.MethodPost,
			URL:    "/api/collections/users/auth-with-oauth2",
			Body: strings.NewReader(`{
				"provider": "google",
				"code": "test-code",
				"redirectURL": "https://example.com/oauth/callback",
				"createData": {"cognosStepUpChallenge": "` + challenge + `"}
			}`),
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"token":"`, `"isNew":false`},
			TestAppFactory: func(testing.TB) *tests.TestApp {
				return app
			},
			DisableTestAppCleanup: true,
			BeforeTestFunc:        withRecordAuth("users", email),
		}
		scenario.Test(t)

		if _, err := store.CompleteStepUpChallenge(user.Id, cognosoauth.ProviderGoogle, challenge); err != nil {
			t.Errorf(
				"CompleteStepUpChallenge(%q, %q, challenge) error = %v, want nil",
				user.Id,
				cognosoauth.ProviderGoogle,
				err,
			)
		}
	})

	t.Run("different Google identity does not confirm challenge", func(t *testing.T) {
		app := setupOAuthHookTestApp(t, cognosoauth.ProviderGoogle, &auth.AuthUser{
			Id:    "google-unlinked-id",
			Email: "different-google@example.com",
		})
		user := mustOAuthHookUser(t, app, email)
		saveExternalAuth(t, app, user, cognosoauth.ProviderGoogle, linkedProviderID)

		store := cognosoauth.NewStore(app)
		challenge, err := store.CreateStepUpChallenge(user.Id, cognosoauth.ProviderGoogle)
		if err != nil {
			t.Fatalf("CreateStepUpChallenge(%q, %q) error = %v", user.Id, cognosoauth.ProviderGoogle, err)
		}

		scenario := tests.ApiScenario{
			Name:   "unlinked Google identity",
			Method: http.MethodPost,
			URL:    "/api/collections/users/auth-with-oauth2",
			Body: strings.NewReader(`{
				"provider": "google",
				"code": "test-code",
				"redirectURL": "https://example.com/oauth/callback",
				"createData": {"cognosStepUpChallenge": "` + challenge + `"}
			}`),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{"Invalid or expired Google re-authentication challenge"},
			TestAppFactory: func(testing.TB) *tests.TestApp {
				return app
			},
			DisableTestAppCleanup: true,
			BeforeTestFunc:        withRecordAuth("users", email),
		}
		scenario.Test(t)

		if _, err := store.CompleteStepUpChallenge(user.Id, cognosoauth.ProviderGoogle, challenge); !errors.Is(err, cognosoauth.ErrNotFound) {
			t.Errorf(
				"CompleteStepUpChallenge(%q, %q, challenge) error = %v, want %v",
				user.Id,
				cognosoauth.ProviderGoogle,
				err,
				cognosoauth.ErrNotFound,
			)
		}
	})
}

func TestOAuthHookRejectsUnsupportedProvider(t *testing.T) {
	const provider = "cognos-test-provider"

	app := setupOAuthHookTestApp(t, provider, &auth.AuthUser{
		Id:    "unsupported-provider-id",
		Email: "new-oauth@example.com",
	})

	scenario := tests.ApiScenario{
		Name:   "unsupported OAuth provider",
		Method: http.MethodPost,
		URL:    "/api/collections/users/auth-with-oauth2",
		Body: strings.NewReader(`{
			"provider": "` + provider + `",
			"code": "test-code",
			"redirectURL": "https://example.com/oauth/callback"
		}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"Unsupported OAuth provider"},
		TestAppFactory: func(testing.TB) *tests.TestApp {
			return app
		},
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

func TestOAuthHookRejectsIncompleteGoogleIdentity(t *testing.T) {
	cases := []struct {
		name    string
		user    *auth.AuthUser
		message string
	}{
		{
			name:    "missing stable provider id",
			user:    &auth.AuthUser{Email: "new-oauth@example.com"},
			message: "Google did not return a stable identity",
		},
		{
			name:    "missing verified email on signup",
			user:    &auth.AuthUser{Id: "google-new-id"},
			message: "Google did not return a verified email",
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			app := setupOAuthHookTestApp(t, cognosoauth.ProviderGoogle, tt.user)
			scenario := tests.ApiScenario{
				Name:   tt.name,
				Method: http.MethodPost,
				URL:    "/api/collections/users/auth-with-oauth2",
				Body: strings.NewReader(`{
					"provider": "google",
					"code": "test-code",
					"redirectURL": "https://example.com/oauth/callback"
				}`),
				ExpectedStatus:  http.StatusBadRequest,
				ExpectedContent: []string{tt.message},
				TestAppFactory: func(testing.TB) *tests.TestApp {
					return app
				},
				DisableTestAppCleanup: true,
			}
			scenario.Test(t)
		})
	}
}

func TestOAuthHookRejectsLinkAndStepUpProofTogether(t *testing.T) {
	const (
		email            = "test1@example.com"
		linkedProviderID = "google-linked-id"
	)

	app := setupOAuthHookTestApp(t, cognosoauth.ProviderGoogle, &auth.AuthUser{
		Id:    linkedProviderID,
		Email: email,
	})
	user := mustOAuthHookUser(t, app, email)
	saveExternalAuth(t, app, user, cognosoauth.ProviderGoogle, linkedProviderID)

	store := cognosoauth.NewStore(app)
	linkIntent, err := store.CreateLinkIntent(user.Id, cognosoauth.ProviderGoogle)
	if err != nil {
		t.Fatalf("CreateLinkIntent(%q, %q) error = %v", user.Id, cognosoauth.ProviderGoogle, err)
	}
	challenge, err := store.CreateStepUpChallenge(user.Id, cognosoauth.ProviderGoogle)
	if err != nil {
		t.Fatalf("CreateStepUpChallenge(%q, %q) error = %v", user.Id, cognosoauth.ProviderGoogle, err)
	}

	scenario := tests.ApiScenario{
		Name:   "link intent and step-up challenge together",
		Method: http.MethodPost,
		URL:    "/api/collections/users/auth-with-oauth2",
		Body: strings.NewReader(`{
			"provider": "google",
			"code": "test-code",
			"redirectURL": "https://example.com/oauth/callback",
			"createData": {
				"cognosLinkIntent": "` + linkIntent + `",
				"cognosStepUpChallenge": "` + challenge + `"
			}
		}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"Choose either Google account linking or re-authentication"},
		TestAppFactory: func(testing.TB) *tests.TestApp {
			return app
		},
		DisableTestAppCleanup: true,
		BeforeTestFunc:        withRecordAuth("users", email),
	}
	scenario.Test(t)

	if err := store.ConsumeLinkIntent(user.Id, cognosoauth.ProviderGoogle, linkIntent); err != nil {
		t.Errorf(
			"ConsumeLinkIntent(%q, %q, linkIntent) error = %v, want nil for unconsumed intent",
			user.Id,
			cognosoauth.ProviderGoogle,
			err,
		)
	}
	if _, err := store.CompleteStepUpChallenge(user.Id, cognosoauth.ProviderGoogle, challenge); !errors.Is(err, cognosoauth.ErrNotFound) {
		t.Errorf(
			"CompleteStepUpChallenge(%q, %q, challenge) error = %v, want %v",
			user.Id,
			cognosoauth.ProviderGoogle,
			err,
			cognosoauth.ErrNotFound,
		)
	}
}

func setupOAuthHookTestApp(t *testing.T, provider string, authUser *auth.AuthUser) *tests.TestApp {
	t.Helper()

	originalFactory, existed := auth.Providers[provider]
	auth.Providers[provider] = func() auth.Provider {
		return &fakeOAuthProvider{authUser: authUser}
	}
	t.Cleanup(func() {
		if existed {
			auth.Providers[provider] = originalFactory
		} else {
			delete(auth.Providers, provider)
		}
	})

	app := setupTestApp(t)
	t.Cleanup(app.Cleanup)

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(users) error = %v", err)
	}
	users.MFA.Enabled = false
	users.OAuth2.Enabled = true
	users.OAuth2.Providers = []core.OAuth2ProviderConfig{{
		Name:         provider,
		ClientId:     "test-client-id",
		ClientSecret: "test-client-secret",
	}}
	if err := app.Save(users); err != nil {
		t.Fatalf("Save(users OAuth provider %q) error = %v", provider, err)
	}

	return app
}

func mustOAuthHookUser(t *testing.T, app *tests.TestApp, email string) *core.Record {
	t.Helper()

	user, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", email, err)
	}
	return user
}

func saveExternalAuth(t *testing.T, app *tests.TestApp, user *core.Record, provider, providerID string) {
	t.Helper()

	externalAuth := core.NewExternalAuth(app)
	externalAuth.SetCollectionRef(user.Collection().Id)
	externalAuth.SetRecordRef(user.Id)
	externalAuth.SetProvider(provider)
	externalAuth.SetProviderId(providerID)
	if err := app.Save(externalAuth); err != nil {
		t.Fatalf(
			"Save(external auth user=%q, provider=%q, providerID=%q) error = %v",
			user.Id,
			provider,
			providerID,
			err,
		)
	}
}
