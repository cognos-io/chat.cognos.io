package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/mfa"
)

func TestAccountRevokeOthersRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "revoke-others rejects anonymous callers",
		Method:          http.MethodPost,
		URL:             "/api/v1/account/sessions/revoke-others",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{requireAuthMessage},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

// TestAccountRevokeOthersInvalidatesOldTokenAndIssuesFreshToken drives the real
// HTTP surface end to end: the caller holds a pre-rotation token, revokes other
// sessions, and the old token is rejected while the newly issued token works.
func TestAccountRevokeOthersInvalidatesOldTokenAndIssuesFreshToken(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	user, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(test1) error = %v", err)
	}

	// Seed a trusted device so we can assert they clear. Vault wrap is kept on
	// purpose for self revoke-others (this device stays unlockable).
	store := mfa.NewStore(app)
	if _, err := store.CreateTrustedDevice(user.Id, "other-laptop"); err != nil {
		t.Fatalf("CreateTrustedDevice: %v", err)
	}

	oldToken, err := user.NewAuthToken()
	if err != nil {
		t.Fatalf("user.NewAuthToken() error = %v", err)
	}
	otherDeviceToken, err := user.NewAuthToken()
	if err != nil {
		t.Fatalf("user.NewAuthToken() (other device) error = %v", err)
	}

	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("apis.NewRouter error = %v", err)
	}
	serveEvent := new(core.ServeEvent)
	serveEvent.App = app
	serveEvent.Router = router

	if err := app.OnServe().Trigger(serveEvent, func(e *core.ServeEvent) error {
		mux, err := e.Router.BuildMux()
		if err != nil {
			t.Fatalf("BuildMux error = %v", err)
		}

		do := func(method, url, token string) (*httptest.ResponseRecorder, []byte) {
			req := httptest.NewRequest(method, url, nil)
			req.Header.Set("content-type", "application/json")
			if token != "" {
				req.Header.Set("Authorization", token)
			}
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			body, _ := io.ReadAll(rec.Body)
			return rec, body
		}

		if rec, _ := do(http.MethodGet, "/api/v1/orgs", oldToken); rec.Code != http.StatusOK {
			t.Fatalf("pre-revocation request status = %d, want 200", rec.Code)
		}

		rec, body := do(http.MethodPost, "/api/v1/account/sessions/revoke-others", oldToken)
		if rec.Code != http.StatusOK {
			t.Fatalf("revoke-others status = %d, want 200; body = %s", rec.Code, body)
		}

		var authResp struct {
			Token  string `json:"token"`
			Record struct {
				ID string `json:"id"`
			} `json:"record"`
		}
		if err := json.Unmarshal(body, &authResp); err != nil {
			t.Fatalf("decode auth response: %v", err)
		}
		if authResp.Token == "" {
			t.Fatal("revoke-others response missing token")
		}
		if authResp.Record.ID != user.Id {
			t.Fatalf("revoke-others record id = %q, want %q", authResp.Record.ID, user.Id)
		}
		if authResp.Token == oldToken {
			t.Fatal("revoke-others returned the same token as before rotation")
		}

		if rec, _ := do(http.MethodGet, "/api/v1/orgs", oldToken); rec.Code != http.StatusUnauthorized {
			t.Errorf("post-revocation old token status = %d, want 401", rec.Code)
		}
		if rec, _ := do(http.MethodGet, "/api/v1/orgs", otherDeviceToken); rec.Code != http.StatusUnauthorized {
			t.Errorf("post-revocation other-device token status = %d, want 401", rec.Code)
		}
		if rec, _ := do(http.MethodGet, "/api/v1/orgs", authResp.Token); rec.Code != http.StatusOK {
			t.Errorf("post-revocation fresh token status = %d, want 200", rec.Code)
		}

		devices, err := store.ListActiveTrustedDevices(user.Id)
		if err != nil {
			t.Fatalf("ListActiveTrustedDevices: %v", err)
		}
		if len(devices) != 0 {
			t.Fatalf("trusted devices remaining = %d, want 0", len(devices))
		}

		return nil
	}); err != nil {
		t.Fatalf("OnServe trigger error = %v", err)
	}
}
