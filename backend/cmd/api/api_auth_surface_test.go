package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
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

// publicAPIv1Routes is the ONLY set of /api/v1 routes allowed to answer an
// anonymous request. Each is gated by a secret in the path or a one-time proof
// and IP rate-limited; adding to this list is a security decision — keep it
// short and documented (docs/api-permissions.md).
var publicAPIv1Routes = map[string]string{
	// Token-gated by the share secret in the path; the URL fragment (held only
	// by the client) is what decrypts the payload.
	"GET /api/v1/public/conversations/{token}":                                 "share token",
	"GET /api/v1/public/conversations/{token}/messages":                        "share token",
	"GET /api/v1/public/conversations/{token}/messages/{messageID}/attachment": "share token",
	"GET /api/v1/public/conversations/{token}/redaction-entries":               "share token (include-sensitive only)",
	// Anonymous id→name catalogue for the shared-conversation page.
	"GET /api/v1/public/models": "public model catalogue",
	// MFA login completion: the caller holds an mfaSessionId (proof the
	// password factor passed), not an auth token yet.
	"POST /api/v1/auth/mfa/totp":     "mfa session proof",
	"POST /api/v1/auth/mfa/recovery": "mfa session proof",
}

// emailVerificationGatedRoutes are the AI-consuming routes that must
// additionally reject users without a verified email (403 EMAIL_NOT_VERIFIED).
// Kept in lock-step with the RequireVerifiedEmail() bindings in routes.go and
// the behavioural coverage in email_verification_test.go.
var emailVerificationGatedRoutes = map[string]struct{}{
	"POST /api/v1/completions":                                {},
	"POST /api/v1/images":                                     {},
	"POST /api/v1/conversations/{conversationID}/complete":    {},
	"POST /api/v1/conversations/{conversationID}/regenerate":  {},
	"POST /api/v1/conversations/{conversationID}/image":       {},
	"POST /api/v1/conversations/{conversationID}/compactions": {},
}

// minExpectedAPIv1Routes guards the enumerator itself: if the parser ever
// silently finds a fraction of the surface (e.g. registration moves to a
// helper it doesn't understand), the test must fail loudly rather than pass
// vacuously. Raise it as the surface grows; never lower it to "fix" a failure
// without understanding why the count dropped.
const minExpectedAPIv1Routes = 87

var routerHTTPMethods = map[string]string{
	"GET":     http.MethodGet,
	"POST":    http.MethodPost,
	"PATCH":   http.MethodPatch,
	"PUT":     http.MethodPut,
	"DELETE":  http.MethodDelete,
	"HEAD":    http.MethodHead,
	"OPTIONS": http.MethodOptions,
	"SEARCH":  "SEARCH",
}

// enumerateRegisteredAPIv1Routes discovers every route registered in this
// package by parsing its (non-test) source with go/parser and collecting
// router registration calls: e.Router.GET("/path", …), .POST, .Route(method,
// path, …) and friends. PocketBase's router keeps its route list unexported,
// so source enumeration is the reliable way to guarantee a newly added route
// can never silently skip this guardrail — every custom route in the backend
// is registered inside package main (go-routing convention: routes.go is the
// API surface map). Each discovered route is then cross-checked against the
// live router with HasRoute, so a stale or mis-parsed entry also fails.
func enumerateRegisteredAPIv1Routes(t *testing.T) []string {
	t.Helper()

	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob package sources: %v", err)
	}

	found := map[string]struct{}{}
	fset := token.NewFileSet()

	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}

		parsed, err := parser.ParseFile(fset, file, nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatalf("parse %s: %v", file, err)
		}

		ast.Inspect(parsed, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}

			method := ""
			var pathArg int
			if httpMethod, ok := routerHTTPMethods[sel.Sel.Name]; ok && len(call.Args) >= 1 {
				method = httpMethod
				pathArg = 0
			} else if sel.Sel.Name == "Route" && len(call.Args) >= 2 {
				if lit, ok := call.Args[0].(*ast.BasicLit); ok && lit.Kind == token.STRING {
					if m, err := strconv.Unquote(lit.Value); err == nil {
						method = strings.ToUpper(m)
					}
				}
				pathArg = 1
			} else {
				return true
			}

			lit, ok := call.Args[pathArg].(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			path, err := strconv.Unquote(lit.Value)
			if err != nil || !strings.HasPrefix(path, "/api/v1") {
				return true
			}

			found[method+" "+path] = struct{}{}
			return true
		})
	}

	routes := make([]string, 0, len(found))
	for route := range found {
		routes = append(routes, route)
	}
	sort.Strings(routes)

	if len(routes) < minExpectedAPIv1Routes {
		t.Fatalf(
			"enumerated only %d /api/v1 routes, expected at least %d — the source enumerator is broken or the surface shrank",
			len(routes), minExpectedAPIv1Routes,
		)
	}

	return routes
}

// TestAPIv1RoutesEnforceAuth is a guardrail over the ENTIRE registered /api/v1
// surface, enumerated from the package source (see
// enumerateRegisteredAPIv1Routes): every route must reject anonymous callers
// with a RequireAuth 401 unless it is on the explicit public allowlist, which
// must stay reachable. AI-consuming routes must additionally reject
// authenticated-but-unverified users with 403 EMAIL_NOT_VERIFIED. A new route
// is picked up automatically — it can only become public (or skip the
// verification gate) by an explicit allowlist change here.
func TestAPIv1RoutesEnforceAuth(t *testing.T) {
	routes := enumerateRegisteredAPIv1Routes(t)

	// Every allowlisted/gated entry must exist, so a rename can't leave a
	// stale allowlist entry silently allowing the wrong route.
	routeSet := map[string]struct{}{}
	for _, rt := range routes {
		routeSet[rt] = struct{}{}
	}
	for rt := range publicAPIv1Routes {
		if _, ok := routeSet[rt]; !ok {
			t.Fatalf("public allowlist entry %q is not a registered route — update publicAPIv1Routes", rt)
		}
	}
	for rt := range emailVerificationGatedRoutes {
		if _, ok := routeSet[rt]; !ok {
			t.Fatalf("verification-gate entry %q is not a registered route — update emailVerificationGatedRoutes", rt)
		}
	}

	app := setupTestApp(t)
	defer app.Cleanup()

	baseRouter, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("apis.NewRouter: %v", err)
	}

	serveEvent := &core.ServeEvent{App: app, Router: baseRouter}
	triggerErr := app.OnServe().Trigger(serveEvent, func(e *core.ServeEvent) error {
		// Bind the unverified seed user for requests carrying this header, so
		// the same mux serves both the anonymous and the unverified probes.
		unverified, err := app.FindAuthRecordByEmail("users", "unverified@example.com")
		if err != nil {
			return err
		}
		const unverifiedProbeHeader = "X-Test-Unverified-Auth"
		e.Router.BindFunc(func(re *core.RequestEvent) error {
			if re.Request.Header.Get(unverifiedProbeHeader) == "1" {
				re.Auth = unverified
			}
			return re.Next()
		})

		mux, err := e.Router.BuildMux()
		if err != nil {
			return err
		}

		probe := func(method, path string, headers map[string]string) *httptest.ResponseRecorder {
			// Fresh rate-limit bucket per probe.
			resetRouteRateLimiters()
			reqPath := routeParamPattern.ReplaceAllString(path, "x")
			recorder := httptest.NewRecorder()
			req := httptest.NewRequest(method, reqPath, nil)
			req.Header.Set("content-type", "application/json")
			for k, v := range headers {
				req.Header.Set(k, v)
			}
			mux.ServeHTTP(recorder, req)
			return recorder
		}

		for _, rt := range routes {
			rt := rt
			parts := strings.SplitN(rt, " ", 2)
			method, path := parts[0], parts[1]

			t.Run(rt, func(t *testing.T) {
				// 1) The parsed route is actually registered (catches a parser
				//    bug or a registration the parser saw but the router lost).
				if !e.Router.HasRoute(method, path) {
					t.Fatalf("route was parsed from source but is not registered on the router")
				}

				// 2) Anonymous probe.
				recorder := probe(method, path, nil)
				body := recorder.Body.String()
				blockedByAuth := recorder.Code == http.StatusUnauthorized &&
					strings.Contains(body, requireAuthMessage)

				if _, isPublic := publicAPIv1Routes[rt]; isPublic {
					if blockedByAuth {
						t.Errorf("public route should be reachable anonymously, got %d: %s", recorder.Code, body)
					}
				} else if !blockedByAuth {
					t.Errorf("route must reject anonymous access with a RequireAuth 401, got %d: %s", recorder.Code, body)
				}

				// 3) Unverified-user probe: AI-consuming routes must 403 with
				//    the machine-readable EMAIL_NOT_VERIFIED code; only GET
				//    routes are additionally asserted NOT to be gated (probing
				//    non-gated mutating routes with real auth would write).
				if _, gated := emailVerificationGatedRoutes[rt]; gated {
					recorder := probe(method, path, map[string]string{"X-Test-Unverified-Auth": "1"})
					if recorder.Code != http.StatusForbidden ||
						!strings.Contains(recorder.Body.String(), `"error":"EMAIL_NOT_VERIFIED"`) {
						t.Errorf(
							"AI-consuming route must reject unverified users with 403 EMAIL_NOT_VERIFIED, got %d: %s",
							recorder.Code, recorder.Body.String(),
						)
					}
				} else if method == http.MethodGet {
					recorder := probe(method, path, map[string]string{"X-Test-Unverified-Auth": "1"})
					if strings.Contains(recorder.Body.String(), `"error":"EMAIL_NOT_VERIFIED"`) {
						t.Errorf("non-AI route must not be verification-gated, got %d: %s", recorder.Code, recorder.Body.String())
					}
				}
			})
		}
		return nil
	})
	if triggerErr != nil {
		t.Fatalf("OnServe trigger: %v", triggerErr)
	}
}
