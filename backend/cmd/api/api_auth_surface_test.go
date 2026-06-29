package main

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// The exact message apis.RequireAuth() returns for an anonymous request.
// Asserting it (not just a 401) proves the RequireAuth middleware is bound,
// rather than a handler-level auth check that happens to also 401.
const requireAuthMessage = "The request requires valid record authorization token."

var routeParamPattern = regexp.MustCompile(`\{[^}]+\}`)

// apiV1Routes is the full /api/v1 surface and whether each route is
// intentionally public. New routes MUST be added here: the existence check in
// the test fails if a listed route is renamed or removed, keeping this table in
// lock-step with the router.
var apiV1Routes = []struct {
	method string
	path   string
	public bool
}{
	{http.MethodGet, "/api/v1/models", false},
	{http.MethodGet, "/api/v1/billing", false},
	{http.MethodGet, "/api/v1/billing/transactions", false},
	{http.MethodGet, "/api/v1/billing/usage", false},
	{http.MethodPost, "/api/v1/billing/checkout", false},
	{http.MethodPost, "/api/v1/billing/portal", false},
	{http.MethodGet, "/api/v1/billing/invoices", false},
	{http.MethodPost, "/api/v1/billing/cancel", false},
	{http.MethodPost, "/api/v1/billing/resume", false},
	{http.MethodGet, "/api/v1/conversations", false},
	{http.MethodPost, "/api/v1/conversations", false},
	{http.MethodPatch, "/api/v1/conversations/{conversationID}", false},
	{http.MethodDelete, "/api/v1/conversations/{conversationID}", false},
	{http.MethodGet, "/api/v1/conversations/{conversationID}/messages", false},
	{http.MethodGet, "/api/v1/conversations/{conversationID}/participants", false},
	{http.MethodPost, "/api/v1/conversations/{conversationID}/participants", false},
	{http.MethodPost, "/api/v1/conversations/{conversationID}/rotate", false},
	{http.MethodGet, "/api/v1/conversations/{conversationID}/public-share", false},
	{http.MethodPost, "/api/v1/conversations/{conversationID}/public-share", false},
	{http.MethodDelete, "/api/v1/conversations/{conversationID}/public-share", false},
	{http.MethodPatch, "/api/v1/messages/{messageID}", false},
	{http.MethodDelete, "/api/v1/messages/{messageID}", false},
	{http.MethodGet, "/api/v1/user-key-pair", false},
	{http.MethodPost, "/api/v1/user-key-pair", false},
	{http.MethodPatch, "/api/v1/user-key-pair/{keyPairID}", false},
	{http.MethodGet, "/api/v1/conversations/{conversationID}/public-key", false},
	{http.MethodPost, "/api/v1/conversations/{conversationID}/public-key", false},
	{http.MethodPatch, "/api/v1/conversations/{conversationID}/public-key/{publicKeyID}", false},
	{http.MethodGet, "/api/v1/conversations/{conversationID}/secret-key", false},
	{http.MethodPost, "/api/v1/conversations/{conversationID}/secret-key", false},
	{http.MethodGet, "/api/v1/user-preferences", false},
	{http.MethodPost, "/api/v1/user-preferences", false},
	{http.MethodPatch, "/api/v1/user-preferences/{preferencesID}", false},
	{http.MethodGet, "/api/v1/vault-session", false},
	{http.MethodPut, "/api/v1/vault-session", false},
	{http.MethodDelete, "/api/v1/vault-session", false},
	{http.MethodPost, "/api/v1/completions", false},
	{http.MethodPost, "/api/v1/completions/{requestID}/stop", false},
	{http.MethodPost, "/api/v1/conversations/{conversationID}/complete", false},
	{http.MethodPost, "/api/v1/conversations/{conversationID}/regenerate", false},

	// Intentionally public: token-gated by the share secret in the path and
	// rate-limited by IP. There is no user session to authenticate.
	{http.MethodGet, "/api/v1/public/conversations/{token}", true},
	{http.MethodGet, "/api/v1/public/conversations/{token}/messages", true},
	{
		http.MethodGet,
		"/api/v1/public/conversations/{token}/messages/{messageID}/attachment",
		true,
	},
}

// TestAPIv1RoutesEnforceAuth is a guardrail: every /api/v1 route must reject
// anonymous callers with a RequireAuth 401, except the explicitly public ones,
// which must stay reachable. It locks the whole surface against a regression
// where a route silently loses its RequireAuth() binding.
func TestAPIv1RoutesEnforceAuth(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	baseRouter, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("apis.NewRouter: %v", err)
	}

	serveEvent := &core.ServeEvent{App: app, Router: baseRouter}
	triggerErr := app.OnServe().Trigger(serveEvent, func(e *core.ServeEvent) error {
		mux, err := e.Router.BuildMux()
		if err != nil {
			return err
		}

		for _, rt := range apiV1Routes {
			rt := rt
			t.Run(rt.method+" "+rt.path, func(t *testing.T) {
				// 1) The route exists exactly as listed (catches renames/removals).
				if !e.Router.HasRoute(rt.method, rt.path) {
					t.Fatalf("route is not registered — update apiV1Routes")
				}

				// 2) Probe it anonymously (fresh rate-limit bucket per probe).
				resetRouteRateLimiters()
				reqPath := routeParamPattern.ReplaceAllString(rt.path, "x")
				recorder := httptest.NewRecorder()
				req := httptest.NewRequest(rt.method, reqPath, nil)
				req.Header.Set("content-type", "application/json")
				mux.ServeHTTP(recorder, req)

				body := recorder.Body.String()
				blockedByAuth := recorder.Code == http.StatusUnauthorized &&
					strings.Contains(body, requireAuthMessage)

				if rt.public {
					if blockedByAuth {
						t.Errorf(
							"public route should be reachable anonymously, got %d: %s",
							recorder.Code, body,
						)
					}
					return
				}

				if !blockedByAuth {
					t.Errorf(
						"route must reject anonymous access with a RequireAuth 401, got %d: %s",
						recorder.Code, body,
					)
				}
			})
		}
		return nil
	})
	if triggerErr != nil {
		t.Fatalf("OnServe trigger: %v", triggerErr)
	}
}
