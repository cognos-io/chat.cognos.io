package main

import (
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestProjectsRequireAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "projects route requires record auth",
		Method:          http.MethodGet,
		URL:             "/api/v1/projects",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

func TestProjectCreate(t *testing.T) {
	t.Parallel()

	encodedData := base64.StdEncoding.EncodeToString([]byte(`{"version":"1","name":"Acme launch"}`))
	wrappedKey := base64.StdEncoding.EncodeToString([]byte("wrapped-project-key"))

	scenario := tests.ApiScenario{
		Name:   "create project",
		Method: http.MethodPost,
		URL:    "/api/v1/projects",
		Body: strings.NewReader(`{
			"data":"` + encodedData + `",
			"wrapped_project_key":"` + wrappedKey + `"
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"data":"` + encodedData + `"`,
			`"key_version":1`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			projects, err := app.FindRecordsByFilter(
				"projects",
				"data={:data}",
				"",
				1,
				0,
				dbx.Params{"data": encodedData},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(projects) error = %v", err)
			}
			if len(projects) != 1 {
				t.Fatalf("FindRecordsByFilter(projects) len = %d, want 1", len(projects))
			}
			project := projects[0]

			user, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail = %v", err)
			}

			participant, err := app.FindFirstRecordByFilter(
				"project_participants",
				"project = {:p} && user = {:u}",
				dbx.Params{"p": project.Id, "u": user.Id},
			)
			if err != nil || participant == nil {
				t.Fatalf("creator participant not seeded: err=%v record=%v", err, participant)
			}
			if got := participant.GetString("role"); got != "Admin" {
				t.Fatalf("creator role = %q, want %q", got, "Admin")
			}

			wrapping, err := app.FindFirstRecordByFilter(
				"project_key_wrappings",
				"project = {:p} && user = {:u}",
				dbx.Params{"p": project.Id, "u": user.Id},
			)
			if err != nil || wrapping == nil {
				t.Fatalf("creator key wrapping not stored: err=%v record=%v", err, wrapping)
			}
			if got := wrapping.GetString("wrapped_project_key"); got != wrappedKey {
				t.Fatalf("wrapped_project_key = %q, want %q", got, wrappedKey)
			}
			if got := wrapping.GetInt("key_version"); got != 1 {
				t.Fatalf("wrapping key_version = %d, want 1", got)
			}
		},
	}

	scenario.Test(t)
}

func TestProjectCreateRequiresWrappedKey(t *testing.T) {
	t.Parallel()

	encodedData := base64.StdEncoding.EncodeToString([]byte(`{"version":"1","name":"No key"}`))

	scenario := tests.ApiScenario{
		Name:            "create project without wrapped key is rejected",
		Method:          http.MethodPost,
		URL:             "/api/v1/projects",
		Body:            strings.NewReader(`{"data":"` + encodedData + `"}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{`Wrapped_project_key is required.`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			// A rejected create must not leave a stranded project row behind.
			projects, err := app.FindRecordsByFilter(
				"projects",
				"data={:data}",
				"",
				1,
				0,
				dbx.Params{"data": encodedData},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(projects) error = %v", err)
			}
			if len(projects) != 0 {
				t.Fatalf("FindRecordsByFilter(projects) len = %d, want 0", len(projects))
			}
		},
	}

	scenario.Test(t)
}

func TestProjectListOnlyReturnsOwnProjects(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "list projects only returns projects the caller participates in",
		Method:         http.MethodGet,
		URL:            "/api/v1/projects",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"ownedproj000001"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, "ownedproj000001", "test1@example.com")
			seedOwnedProject(t, app, "ownedproj000002", "test2@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			bodyBytes, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(response.Body) error = %v", err)
			}
			if strings.Contains(string(bodyBytes), `"id":"ownedproj000002"`) {
				t.Fatalf("response body contains other user's project: %s", string(bodyBytes))
			}
		},
	}

	scenario.Test(t)
}

func TestProjectGetOtherUserReturnsNotFound(t *testing.T) {
	t.Parallel()

	projectID := "ownedproj000003"

	scenario := tests.ApiScenario{
		Name:            "get other user project returns not found",
		Method:          http.MethodGet,
		URL:             "/api/v1/projects/" + projectID,
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Project not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectUpdate(t *testing.T) {
	t.Parallel()

	projectID := "ownedproj000004"
	updatedData := base64.StdEncoding.EncodeToString([]byte(`{"version":"1","name":"Renamed"}`))

	scenario := tests.ApiScenario{
		Name:           "update project",
		Method:         http.MethodPatch,
		URL:            "/api/v1/projects/" + projectID,
		Body:           strings.NewReader(`{"data":"` + updatedData + `","archived_at":""}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + projectID + `"`,
			`"data":"` + updatedData + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectUpdateOtherUserReturnsNotFound(t *testing.T) {
	t.Parallel()

	projectID := "ownedproj000005"
	updatedData := base64.StdEncoding.EncodeToString([]byte(`{"version":"1","name":"Hijack"}`))

	scenario := tests.ApiScenario{
		Name:            "update other user project returns not found",
		Method:          http.MethodPatch,
		URL:             "/api/v1/projects/" + projectID,
		Body:            strings.NewReader(`{"data":"` + updatedData + `"}`),
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Project not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectDelete(t *testing.T) {
	t.Parallel()

	projectID := "ownedproj000006"

	scenario := tests.ApiScenario{
		Name:           "delete project",
		Method:         http.MethodDelete,
		URL:            "/api/v1/projects/" + projectID,
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindRecordById("projects", projectID); err == nil {
				t.Fatalf("FindRecordById(projects, %q) error = nil, want non-nil after delete", projectID)
			}
			// Participants and key wrappings cascade off the project.
			participants, err := app.FindRecordsByFilter(
				"project_participants",
				"project = {:p}",
				"",
				10,
				0,
				dbx.Params{"p": projectID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(project_participants) error = %v", err)
			}
			if len(participants) != 0 {
				t.Fatalf("project_participants not cascaded: len = %d, want 0", len(participants))
			}
			wrappings, err := app.FindRecordsByFilter(
				"project_key_wrappings",
				"project = {:p}",
				"",
				10,
				0,
				dbx.Params{"p": projectID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(project_key_wrappings) error = %v", err)
			}
			if len(wrappings) != 0 {
				t.Fatalf("project_key_wrappings not cascaded: len = %d, want 0", len(wrappings))
			}
		},
	}

	scenario.Test(t)
}

func TestProjectDeleteOtherUserReturnsNotFound(t *testing.T) {
	t.Parallel()

	projectID := "ownedproj000007"

	scenario := tests.ApiScenario{
		Name:            "delete other user project returns not found",
		Method:          http.MethodDelete,
		URL:             "/api/v1/projects/" + projectID,
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Project not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

// TestProjectCollectionRulesAreLocked pins the same stance as the chat
// collections: every project collection rule is nil so the
// /api/collections/* surface rejects all callers and access flows only
// through the /api/v1 handlers, which authorise in Go.
func TestProjectCollectionRulesAreLocked(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	for _, name := range []string{"projects", "project_participants", "project_key_wrappings"} {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatalf("FindCollectionByNameOrId(%q) error = %v", name, err)
		}

		rulesByName := map[string]*string{
			"list":   collection.ListRule,
			"view":   collection.ViewRule,
			"create": collection.CreateRule,
			"update": collection.UpdateRule,
			"delete": collection.DeleteRule,
		}
		for op, rule := range rulesByName {
			if rule != nil {
				t.Errorf("%s.%s rule = %q, want nil (locked)", name, op, *rule)
			}
		}
	}
}

func seedOwnedProject(t testing.TB, app *tests.TestApp, projectID, ownerEmail string) {
	t.Helper()

	userRecord, err := app.FindAuthRecordByEmail("users", ownerEmail)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", ownerEmail, err)
	}

	collection, err := app.FindCollectionByNameOrId("projects")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(projects) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Id = projectID
	record.Set("creator", userRecord.Id)
	record.Set("data", base64.StdEncoding.EncodeToString([]byte(`{"version":"1","name":"Seeded"}`)))
	record.Set("key_version", 1)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(projectRecord) error = %v", err)
	}

	// Mirror ProjectsCreate: every owned project must have an Admin
	// participant row, otherwise accessibleProjectRecord 404s the creator.
	seedProjectParticipant(t, app, projectID, userRecord.Id, "Admin")

	// Also store a key wrapping so the project is decryptable, matching
	// production's transactional create.
	wrappingCollection, err := app.FindCollectionByNameOrId("project_key_wrappings")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(project_key_wrappings) error = %v", err)
	}
	wrapping := core.NewRecord(wrappingCollection)
	wrapping.Set("project", projectID)
	wrapping.Set("user", userRecord.Id)
	wrapping.Set("key_version", 1)
	wrapping.Set("wrapped_project_key", base64.StdEncoding.EncodeToString([]byte("wrapped")))
	if err := app.Save(wrapping); err != nil {
		t.Fatalf("Save(projectKeyWrapping) error = %v", err)
	}
}

func seedProjectParticipant(t testing.TB, app *tests.TestApp, projectID, userID, role string) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("project_participants")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(project_participants) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Set("project", projectID)
	record.Set("user", userID)
	record.Set("role", role)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(projectParticipantRecord) error = %v", err)
	}
}
