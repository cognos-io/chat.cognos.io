package main

import (
	"encoding/base64"
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/cognos-io/chat.cognos.io/backend/internal/hooks"
)

// The split-key persistent session keeps a device unlocked without re-entering
// the Account Key. Now that idle auto-logout is gone, an idle-TTL on the
// server-side wrap key bounds an abandoned-but-open device: a wrap key unused
// for longer than the TTL is swept, forcing a fresh Account Key unlock.

func seedWrapKey(t *testing.T, app *tests.TestApp, email string, lastUsed types.DateTime) {
	t.Helper()
	user, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(%s) error = %v", email, err)
	}
	collection, err := app.FindCollectionByNameOrId("vault_session_wrap_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId error = %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("user", user.Id)
	record.Set("wrap_key", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	record.Set("last_used_at", lastUsed)
	if err := app.Save(record); err != nil {
		t.Fatalf("save wrap key for %s: %v", email, err)
	}
}

func hasWrapKey(t *testing.T, app *tests.TestApp, email string) bool {
	t.Helper()
	user, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(%s) error = %v", email, err)
	}
	_, err = app.FindFirstRecordByData("vault_session_wrap_keys", "user", user.Id)
	return err == nil
}

func TestVaultSessionSweepDeletesIdleKeys(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	// test1 last used 40 days ago (idle); test2 used just now (active).
	seedWrapKey(t, app, "test1@example.com", types.NowDateTime().Add(-40*24*time.Hour))
	seedWrapKey(t, app, "test2@example.com", types.NowDateTime())

	repo := hooks.NewPocketBaseVaultSessionWrapKeyRepo(app)
	cutoff := time.Now().Add(-30 * 24 * time.Hour)
	if err := repo.DeleteIdleBefore(cutoff); err != nil {
		t.Fatalf("DeleteIdleBefore error = %v", err)
	}

	if hasWrapKey(t, app, "test1@example.com") {
		t.Fatal("idle wrap key should have been swept")
	}
	if !hasWrapKey(t, app, "test2@example.com") {
		t.Fatal("active wrap key should have survived the sweep")
	}
}

func TestVaultSessionGetTouchesLastUsed(t *testing.T) {
	app := setupTestApp(t)
	defer app.Cleanup()

	// Seed a wrap key that looks long-idle; fetching it must mark it fresh so
	// an actively-used session is never swept.
	seedWrapKey(t, app, "test1@example.com", types.NowDateTime().Add(-40*24*time.Hour))

	scenario := tests.ApiScenario{
		Name:                  "vault session get touches last_used_at",
		Method:                http.MethodGet,
		URL:                   "/api/v1/vault-session",
		ExpectedStatus:        http.StatusOK,
		ExpectedContent:       []string{`"wrap_key":"`},
		DisableTestAppCleanup: true,
		TestAppFactory: func(testing.TB) *tests.TestApp {
			return app
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			user, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail error = %v", err)
			}
			record, err := app.FindFirstRecordByData("vault_session_wrap_keys", "user", user.Id)
			if err != nil {
				t.Fatalf("wrap key missing after GET: %v", err)
			}
			if !record.GetDateTime("last_used_at").After(types.NowDateTime().Add(-1 * time.Hour)) {
				t.Fatalf("last_used_at was not touched on read: %v", record.GetDateTime("last_used_at"))
			}
		},
	}
	scenario.Test(t)
}
