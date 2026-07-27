package main

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/oauth"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestAccountAuthMethodsRequiresAuth(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:            "anonymous rejected",
		Method:          http.MethodGet,
		URL:             "/api/v1/account/auth-methods",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}
	scenario.Test(t)
}

func TestAccountAuthMethodsReturnsPasswordAccount(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "password account has hasPassword true and empty providers",
		Method:         http.MethodGet,
		URL:            "/api/v1/account/auth-methods",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"hasPassword":true`,
			`"providers":[]`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", testUserEmail),
	}
	scenario.Test(t)
}

func TestAccountOAuthLinkIntentRequiresPassword(t *testing.T) {
	t.Parallel()
	scenarios := []tests.ApiScenario{
		{
			Name:           "wrong password rejected",
			Method:         http.MethodPost,
			URL:            "/api/v1/account/oauth/link-intent",
			Body:           strings.NewReader(`{"password":"wrong-password","provider":"google"}`),
			ExpectedStatus: http.StatusBadRequest,
			ExpectedContent: []string{
				"Incorrect password",
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withRecordAuth("users", testUserEmail),
		},
		{
			Name:           "correct password returns linkIntentId",
			Method:         http.MethodPost,
			URL:            "/api/v1/account/oauth/link-intent",
			Body:           strings.NewReader(`{"password":"` + testUserPassword + `","provider":"google"}`),
			ExpectedStatus: http.StatusOK,
			ExpectedContent: []string{
				`"linkIntentId":`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withRecordAuth("users", testUserEmail),
		},
	}
	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestAccountOAuthStepUpBeginRejectsPasswordAccount(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "password account cannot begin oauth step-up",
		Method:         http.MethodPost,
		URL:            "/api/v1/account/oauth/step-up/begin",
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			"Use your password to delete this account",
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", testUserEmail),
	}
	scenario.Test(t)
}

func TestAccountDeleteRequiresGoogleStepUpForOAuthOnly(t *testing.T) {
	t.Parallel()
	scenario := tests.ApiScenario{
		Name:           "oauth-only account rejects password-only delete body",
		Method:         http.MethodDelete,
		URL:            "/api/v1/account",
		Body:           strings.NewReader(`{"password":"anything"}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			"Google re-authentication required",
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			markUserOAuthOnly(t, app, testUserEmail)
			withRecordAuth("users", testUserEmail)(t, app, e)
		},
	}
	scenario.Test(t)
}

func TestAccountDeleteAcceptsOAuthStepUp(t *testing.T) {
	t.Parallel()

	body := &deferredBody{}
	scenario := tests.ApiScenario{
		Name:           "oauth-only account deletes with valid step-up",
		Method:         http.MethodDelete,
		URL:            "/api/v1/account",
		Body:           body,
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			markUserOAuthOnly(t, app, testUserEmail)
			userID := mustUserID(t, app, testUserEmail)
			store := oauth.NewStore(app)
			challenge, err := store.CreateStepUpChallenge(userID, oauth.ProviderGoogle)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.ConfirmStepUpChallenge(userID, oauth.ProviderGoogle, challenge); err != nil {
				t.Fatal(err)
			}
			stepUpID, err := store.CompleteStepUpChallenge(userID, oauth.ProviderGoogle, challenge)
			if err != nil {
				t.Fatal(err)
			}
			body.Set(`{"oauthStepUpId":"` + stepUpID + `"}`)
			withRecordAuth("users", testUserEmail)(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			if _, err := app.FindAuthRecordByEmail("users", testUserEmail); err == nil {
				t.Fatal("expected user to be deleted")
			}
		},
	}
	scenario.Test(t)
}

func TestAccountDeleteRejectsOAuthStepUpWithoutGoogleLink(t *testing.T) {
	t.Parallel()
	// has_cognos_password=false but no Google external auth — must not delete
	// via oauthStepUpId (defense in depth against a corrupted flag).
	body := &deferredBody{}
	scenario := tests.ApiScenario{
		Name:           "corrupted oauth-only flag without google link rejected",
		Method:         http.MethodDelete,
		URL:            "/api/v1/account",
		Body:           body,
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			"Google is not connected to this account",
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			user, err := app.FindAuthRecordByEmail("users", testUserEmail)
			if err != nil {
				t.Fatal(err)
			}
			user.Set("has_cognos_password", false)
			if err := app.Save(user); err != nil {
				t.Fatal(err)
			}
			store := oauth.NewStore(app)
			challenge, err := store.CreateStepUpChallenge(user.Id, oauth.ProviderGoogle)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.ConfirmStepUpChallenge(user.Id, oauth.ProviderGoogle, challenge); err != nil {
				t.Fatal(err)
			}
			stepUpID, err := store.CompleteStepUpChallenge(user.Id, oauth.ProviderGoogle, challenge)
			if err != nil {
				t.Fatal(err)
			}
			body.Set(`{"oauthStepUpId":"` + stepUpID + `"}`)
			withRecordAuth("users", testUserEmail)(t, app, e)
		},
	}
	scenario.Test(t)
}

// deferredBody lets BeforeTestFunc mint a one-time token before the request body
// is read by the test harness.
type deferredBody struct {
	r io.Reader
}

func (b *deferredBody) Set(s string) { b.r = strings.NewReader(s) }

func (b *deferredBody) Read(p []byte) (int, error) {
	if b.r == nil {
		return 0, io.EOF
	}
	return b.r.Read(p)
}

func markUserOAuthOnly(t testing.TB, app core.App, email string) {
	t.Helper()
	user, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatal(err)
	}
	user.Set("has_cognos_password", false)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	ea := core.NewExternalAuth(app)
	ea.SetCollectionRef(user.Collection().Id)
	ea.SetRecordRef(user.Id)
	ea.SetProvider(oauth.ProviderGoogle)
	ea.SetProviderId("google-test-" + user.Id)
	if err := app.Save(ea); err != nil {
		t.Fatal(err)
	}
}

func mustUserID(t testing.TB, app core.App, email string) string {
	t.Helper()
	user, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatal(err)
	}
	return user.Id
}
