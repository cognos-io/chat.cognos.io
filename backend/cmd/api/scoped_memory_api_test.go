package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// These tests pin the authorization boundaries of the scoped-memory routes
// (spec §16). User memory is owner-only; project memory is gated by active
// project membership. A non-owner / non-member must get the same neutral 404 a
// missing record returns, so ids can't be probed. The ciphertext round-trips are
// covered by the Playwright e2e (scoped-memory-api.spec.ts); here we prove the
// owner/member denial boundaries against a real PocketBase.

const (
	memOwnerID      = "umemowned000001"
	memProjectID    = "pmemproj0000001"
	memProjectEntry = "pmementry000001"
	memDataB64      = "bWVtb3J5Y2lwaGVy"
	memOtherDataB64 = "b3RoZXJjaXBoZXJ4"
)

// bindAuthAs authenticates every request in the scenario as the given user.
func bindAuthAs(t testing.TB, app *tests.TestApp, e *core.ServeEvent, email string) {
	record, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatal(err)
	}
	e.Router.BindFunc(func(re *core.RequestEvent) error {
		re.Auth = record
		return re.Next()
	})
}

func seedUserMemory(t testing.TB, app *tests.TestApp, id, ownerEmail, data string) {
	t.Helper()
	owner, err := app.FindAuthRecordByEmail("users", ownerEmail)
	if err != nil {
		t.Fatal(err)
	}
	collection, err := app.FindCollectionByNameOrId("user_memory")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(user_memory) = %v", err)
	}
	record := core.NewRecord(collection)
	record.Id = id
	record.Set("user", owner.Id)
	record.Set("data", data)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(user_memory) = %v", err)
	}
}

func seedProjectMemory(t testing.TB, app *tests.TestApp, id, projectID, data string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("project_memory")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(project_memory) = %v", err)
	}
	record := core.NewRecord(collection)
	record.Id = id
	record.Set("project", projectID)
	record.Set("data", data)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(project_memory) = %v", err)
	}
}

// TestUserMemoryOwnerScoped proves user-memory is readable/mutable only by its
// owner: the list excludes other users' rows, and update/delete of a foreign row
// is an indistinguishable 404.
func TestUserMemoryOwnerScoped(t *testing.T) {
	t.Parallel()

	// test1 owns memOwnerID; test2 owns a separate row.
	seedBoth := func(email string) func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		return func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedUserMemory(t, app, memOwnerID, "test1@example.com", memDataB64)
			seedUserMemory(t, app, "umemother000001", "test2@example.com", memOtherDataB64)
			bindAuthAs(t, app, e, email)
		}
	}

	scenarios := []tests.ApiScenario{
		{
			Name:            "user-memory list returns only the caller's rows",
			Method:          http.MethodGet,
			URL:             "/api/v1/user-memory",
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"data":"` + memDataB64 + `"`},
			NotExpectedContent: []string{
				`"data":"` + memOtherDataB64 + `"`,
			},
			TestAppFactory: setupTestApp,
			BeforeTestFunc: seedBoth("test1@example.com"),
		},
		{
			Name:            "user-memory update by a non-owner is 404",
			Method:          http.MethodPatch,
			URL:             "/api/v1/user-memory/" + memOwnerID,
			Body:            strings.NewReader(`{"data":"` + memOtherDataB64 + `"}`),
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{"Memory not found"},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seedBoth("test2@example.com"),
		},
		{
			Name:            "user-memory delete by a non-owner is 404",
			Method:          http.MethodDelete,
			URL:             "/api/v1/user-memory/" + memOwnerID,
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{"Memory not found"},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seedBoth("test2@example.com"),
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// TestProjectMemoryMembershipScoped proves project-memory is gated by active
// project membership: a member can read it, while a non-member is denied
// create/list/update/delete with the same neutral 404.
func TestProjectMemoryMembershipScoped(t *testing.T) {
	t.Parallel()

	// A project owned by test1 (admin) with one memory row. test2 is NOT a member.
	seedProject := func(email string) func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		return func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, memProjectID, "test1@example.com")
			seedProjectMemory(t, app, memProjectEntry, memProjectID, memDataB64)
			bindAuthAs(t, app, e, email)
		}
	}

	scenarios := []tests.ApiScenario{
		{
			Name:            "project-memory list is readable by an active member",
			Method:          http.MethodGet,
			URL:             "/api/v1/projects/" + memProjectID + "/memory",
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"data":"` + memDataB64 + `"`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seedProject("test1@example.com"),
		},
		{
			Name:            "project-memory list by a non-member is 404",
			Method:          http.MethodGet,
			URL:             "/api/v1/projects/" + memProjectID + "/memory",
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{"Project not found"},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seedProject("test2@example.com"),
		},
		{
			Name:            "project-memory create by a non-member is 404",
			Method:          http.MethodPost,
			URL:             "/api/v1/projects/" + memProjectID + "/memory",
			Body:            strings.NewReader(`{"data":"` + memOtherDataB64 + `"}`),
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{"Project not found"},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seedProject("test2@example.com"),
		},
		{
			Name:            "project-memory update by a non-member is 404",
			Method:          http.MethodPatch,
			URL:             "/api/v1/project-memory/" + memProjectEntry,
			Body:            strings.NewReader(`{"data":"` + memOtherDataB64 + `"}`),
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{"Project not found"},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seedProject("test2@example.com"),
		},
		{
			Name:            "project-memory delete by a non-member is 404",
			Method:          http.MethodDelete,
			URL:             "/api/v1/project-memory/" + memProjectEntry,
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{"Project not found"},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seedProject("test2@example.com"),
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}
