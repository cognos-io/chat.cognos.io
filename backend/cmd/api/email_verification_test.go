package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// aiConsumingRoutes are the /api/v1 endpoints that trigger a paid AI provider
// call. The owner's requirement: "email verification should be mandatory before
// any chat messages can be sent" — so each of these must 403 with the
// machine-readable EMAIL_NOT_VERIFIED code for an unverified user, and pass the
// gate (i.e. proceed to the handler's own validation) once verified.
//
// NOT gated: reading conversations, key setup, billing, account endpoints,
// completion stop (only cancels an in-flight request), manual compaction
// (stores client ciphertext without a provider call), and attachment CRUD
// (files only consume AI once referenced by a completion, which is gated).
var aiConsumingRoutes = []struct {
	method string
	path   string
}{
	{http.MethodPost, "/api/v1/completions"},
	{http.MethodPost, "/api/v1/conversations/x/complete"},
	{http.MethodPost, "/api/v1/conversations/x/regenerate"},
	{http.MethodPost, "/api/v1/conversations/x/image"},
	{http.MethodPost, "/api/v1/conversations/x/compactions"},
}

func TestAIEndpointsRejectUnverifiedEmail(t *testing.T) {
	t.Parallel()

	for _, rt := range aiConsumingRoutes {
		rt := rt
		scenario := tests.ApiScenario{
			Name:           "unverified user is blocked: " + rt.method + " " + rt.path,
			Method:         rt.method,
			URL:            rt.path,
			Body:           strings.NewReader(`{}`),
			ExpectedStatus: http.StatusForbidden,
			ExpectedContent: []string{
				`"error":"EMAIL_NOT_VERIFIED"`,
				`"next_step":"verify_email"`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withRecordAuth("users", "unverified@example.com"),
		}
		scenario.Test(t)
	}
}

func TestAIEndpointsAllowVerifiedEmailPastTheGate(t *testing.T) {
	t.Parallel()

	for _, rt := range aiConsumingRoutes {
		rt := rt
		scenario := tests.ApiScenario{
			Name:   "verified user passes the gate: " + rt.method + " " + rt.path,
			Method: rt.method,
			URL:    rt.path,
			Body:   strings.NewReader(`{}`),
			// The empty body fails the handler's own validation (400) or the
			// conversation lookup (404) — the point is it is NOT the 403
			// verification gate.
			ExpectedStatus: http.StatusBadRequest,
			NotExpectedContent: []string{
				`EMAIL_NOT_VERIFIED`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		}
		if strings.Contains(rt.path, "/compactions") {
			// Compaction authorises the conversation before validating the
			// body, and an inaccessible conversation is a neutral 404.
			scenario.ExpectedStatus = http.StatusNotFound
		}
		scenario.Test(t)
	}
}

// A user who verifies mid-session is unblocked immediately: PocketBase resolves
// the auth record from the token on every request, so once the record's
// verified flag flips the very same token passes the gate. We pin the
// record-level behaviour by flipping the seeded unverified user and re-probing.
func TestAIEndpointsUnblockAfterMidSessionVerification(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "verifying mid-session unblocks completions",
		Method:         http.MethodPost,
		URL:            "/api/v1/completions",
		Body:           strings.NewReader(`{}`),
		ExpectedStatus: http.StatusBadRequest, // handler validation, not the gate
		NotExpectedContent: []string{
			`EMAIL_NOT_VERIFIED`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			record, err := app.FindAuthRecordByEmail("users", "unverified@example.com")
			if err != nil {
				t.Fatal(err)
			}
			record.SetVerified(true)
			if err := app.Save(record); err != nil {
				t.Fatal(err)
			}
			withRecordAuth("users", "unverified@example.com")(t, app, e)
		},
	}
	scenario.Test(t)
}

// Unverified users keep full access to everything that does not consume AI —
// reading conversations, key setup, billing and account endpoints. Chat
// history and account management must never be held hostage by verification.
func TestNonAIEndpointsRemainAvailableToUnverifiedUsers(t *testing.T) {
	t.Parallel()

	routes := []struct {
		method string
		path   string
		status int
	}{
		{http.MethodGet, "/api/v1/conversations", http.StatusOK},
		{http.MethodGet, "/api/v1/models", http.StatusOK},
		{http.MethodGet, "/api/v1/billing", http.StatusOK},
		// No key pair seeded for the unverified user — the point is it's a
		// neutral 404, not the verification 403.
		{http.MethodGet, "/api/v1/user-key-pair", http.StatusNotFound},
		{http.MethodPost, "/api/v1/completions/x/stop", http.StatusNoContent},
	}

	for _, rt := range routes {
		rt := rt
		scenario := tests.ApiScenario{
			Name:   "unverified user keeps access: " + rt.method + " " + rt.path,
			Method: rt.method,
			URL:    rt.path,
			NotExpectedContent: []string{
				`EMAIL_NOT_VERIFIED`,
			},
			ExpectedStatus: rt.status,
			TestAppFactory: setupTestApp,
			BeforeTestFunc: withRecordAuth("users", "unverified@example.com"),
		}
		scenario.Test(t)
	}
}
