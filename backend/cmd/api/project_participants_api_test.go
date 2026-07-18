package main

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// ---------------------------------------------------------------------------
// GET /api/v1/projects/{projectID}/participants
// ---------------------------------------------------------------------------

func TestProjectParticipantsListRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "project participants route requires record auth",
		Method:          http.MethodGet,
		URL:             "/api/v1/projects/anyprojid000001/participants",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

func TestProjectParticipantsListReturnsActiveMembers(t *testing.T) {
	t.Parallel()

	const projectID = "projparts000010"

	scenario := tests.ApiScenario{
		Name:           "list project participants returns active members",
		Method:         http.MethodGet,
		URL:            "/api/v1/projects/" + projectID + "/participants",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"role":"Admin"`,
			`"role":"Editor"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			guest, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail = %v", err)
			}
			seedProjectParticipant(t, app, projectID, guest.Id, "Editor")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectParticipantsListRejectsNonParticipant(t *testing.T) {
	t.Parallel()

	const projectID = "projparts000011"

	scenario := tests.ApiScenario{
		Name:           "list project participants 404s for non-participants",
		Method:         http.MethodGet,
		URL:            "/api/v1/projects/" + projectID + "/participants",
		ExpectedStatus: http.StatusNotFound,
		ExpectedContent: []string{
			`"message":"Project not found."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectParticipantsListAllowsOrgAdmin(t *testing.T) {
	t.Parallel()

	const projectID = "projparts000012"
	const orgID = "orgparts0000001"

	// An org admin who is NOT a project participant can still list participants.
	scenario := tests.ApiScenario{
		Name:           "org admin can list participants without being a project participant",
		Method:         http.MethodGet,
		URL:            "/api/v1/projects/" + projectID + "/participants",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"role":"Admin"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Parts Org", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			// test2 is an org member but not a project participant.
			seedOrgMembership(t, app, orgID, "test2@example.com", "admin", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{projectID}/participants
// ---------------------------------------------------------------------------

func TestProjectParticipantsAddSucceedsForAdmin(t *testing.T) {
	t.Parallel()

	const projectID = "projpartadd0001"
	const orgID = "orgpartadd00001"

	scenario := tests.ApiScenario{
		Name:   "project Admin can add a participant + wrapped key in one call",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/participants",
		Body: strings.NewReader(`{
			"user_id": "xq9ndvc2kbrvrng",
			"role": "Editor",
			"wrapped_project_key": "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD="
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"role":"Editor"`,
			`"user_id":"xq9ndvc2kbrvrng"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Add Org", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			// Target user must be an org member.
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			participant, err := app.FindFirstRecordByFilter(
				"project_participants",
				"project = {:p} && user = {:u}",
				dbx.Params{"p": projectID, "u": "xq9ndvc2kbrvrng"},
			)
			if err != nil || participant == nil {
				t.Fatalf("FindFirstRecordByFilter(project_participants) err=%v rec=%v", err, participant)
			}
			if got := participant.GetString("role"); got != "Editor" {
				t.Fatalf("project_participants.role = %q, want Editor", got)
			}

			wrapping, err := app.FindFirstRecordByFilter(
				"project_key_wrappings",
				"project = {:p} && user = {:u}",
				dbx.Params{"p": projectID, "u": "xq9ndvc2kbrvrng"},
			)
			if err != nil || wrapping == nil {
				t.Fatalf("FindFirstRecordByFilter(project_key_wrappings) err=%v rec=%v", err, wrapping)
			}
			if got := wrapping.GetInt("key_version"); got != 1 {
				t.Fatalf("project_key_wrappings.key_version = %d, want 1", got)
			}
			if got := wrapping.GetString("wrapped_project_key"); got != "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=" {
				t.Fatalf("project_key_wrappings.wrapped_project_key = %q, want the wrapped value", got)
			}
		},
	}

	scenario.Test(t)
}

func TestProjectParticipantsAddByOrgAdminNotParticipant(t *testing.T) {
	t.Parallel()

	const projectID = "projpartadd0002"
	const orgID = "orgpartadd00002"

	// Org admin who is not a project participant can still add members.
	scenario := tests.ApiScenario{
		Name:   "org admin can add project participants without being a project participant",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/participants",
		Body: strings.NewReader(`{
			"user_id": "j8prcx3dum2l3kc",
			"role": "Viewer",
			"wrapped_project_key": "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE="
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"role":"Viewer"`,
			`"user_id":"j8prcx3dum2l3kc"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Add Org 2", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			seedOrgMembership(t, app, orgID, "no_data@example.com", "member", false)
			// test2 is org admin but NOT a project participant.
			seedOrgMembership(t, app, orgID, "test2@example.com", "admin", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectParticipantsAddRejectsNonAdmin(t *testing.T) {
	t.Parallel()

	const projectID = "projpartadd0003"
	const orgID = "orgpartadd00003"

	scenario := tests.ApiScenario{
		Name:   "Editor cannot add another project participant",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/participants",
		Body: strings.NewReader(`{
			"user_id": "j8prcx3dum2l3kc",
			"role": "Viewer",
			"wrapped_project_key": "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF="
		}`),
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`"message":"Only project admins can add participants."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Add Org 3", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			editor, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail = %v", err)
			}
			seedProjectParticipant(t, app, projectID, editor.Id, "Editor")
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, err := app.FindRecordsByFilter(
				"project_participants",
				"project = {:p} && user = {:u}",
				"",
				1, 0,
				dbx.Params{"p": projectID, "u": "j8prcx3dum2l3kc"},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(project_participants) err=%v", err)
			}
			if len(records) != 0 {
				t.Fatalf("non-Admin write persisted participant row")
			}
		},
	}

	scenario.Test(t)
}

func TestProjectParticipantsAddRejectsNonMember(t *testing.T) {
	t.Parallel()

	const projectID = "projpartadd0004"
	const orgID = "orgpartadd00004"

	scenario := tests.ApiScenario{
		Name:   "non-member cannot be added to an org project",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/participants",
		Body: strings.NewReader(`{
			"user_id": "j8prcx3dum2l3kc",
			"role": "Viewer",
			"wrapped_project_key": "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG="
		}`),
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`"message":"Target user is not a member of the owning organisation."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Add Org 4", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			// test2 (xq9ndvc2kbrvrng) is an org member; no_data (j8prcx3dum2l3kc) is NOT.
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectParticipantsAddRejectsPersonalProject(t *testing.T) {
	t.Parallel()

	const projectID = "projpartadd0005"

	// Personal (non-org) projects reject sharing in v1.
	scenario := tests.ApiScenario{
		Name:   "adding participant to personal project is rejected",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/participants",
		Body: strings.NewReader(`{
			"user_id": "xq9ndvc2kbrvrng",
			"role": "Viewer",
			"wrapped_project_key": "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH="
		}`),
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`"message":"Sharing requires an organisation."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectParticipantsAddReactivatesSoftRevokedRow(t *testing.T) {
	t.Parallel()

	const projectID = "projreadd000001"
	const targetUser = "xq9ndvc2kbrvrng"
	const orgID = "orgreadd0000001"

	scenario := tests.ApiScenario{
		Name:   "Re-adding a soft-revoked project participant re-activates the row",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/participants",
		Body: strings.NewReader(`{
			"user_id": "` + targetUser + `",
			"role": "Viewer",
			"wrapped_project_key": "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH="
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"role":"Viewer"`,
			`"user_id":"` + targetUser + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Re-add Org", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			seedProjectParticipant(t, app, projectID, targetUser, "Editor")
			revokeProjectParticipant(t, app, projectID, targetUser)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			rows, err := app.FindRecordsByFilter(
				"project_participants",
				"project = {:p} && user = {:u}",
				"",
				10, 0,
				dbx.Params{"p": projectID, "u": targetUser},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter err=%v", err)
			}
			if len(rows) != 1 {
				t.Fatalf("expected 1 project_participants row (re-activated), got %d", len(rows))
			}
			if got := rows[0].GetString("removed_at"); got != "" {
				t.Fatalf("removed_at = %q after re-add, want empty", got)
			}
			if got := rows[0].GetString("role"); got != "Viewer" {
				t.Fatalf("role = %q after re-add, want Viewer", got)
			}
		},
	}
	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/projects/{projectID}/participants/{userID}
// ---------------------------------------------------------------------------

func TestProjectParticipantsRevokeRequiresAdmin(t *testing.T) {
	t.Parallel()

	const projectID = "projpartrev0001"
	const orgID = "orgpartrev00001"

	scenario := tests.ApiScenario{
		Name:           "Editor cannot revoke a project participant",
		Method:         http.MethodDelete,
		URL:            "/api/v1/projects/" + projectID + "/participants/xq9ndvc2kbrvrng",
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`"message":"Only project admins can revoke participants."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Revoke Org", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			editor, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail = %v", err)
			}
			seedProjectParticipant(t, app, projectID, editor.Id, "Editor")
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectParticipantsRevokeProtectsCreator(t *testing.T) {
	t.Parallel()

	const projectID = "projpartrev0002"
	const orgID = "orgpartrev00002"

	scenario := tests.ApiScenario{
		Name:           "cannot revoke the project creator",
		Method:         http.MethodDelete,
		URL:            "/api/v1/projects/" + projectID + "/participants/uvi8zmr78j9y5hz",
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Cannot revoke the project creator."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Revoke Org 2", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectParticipantsRevokeHappyPath(t *testing.T) {
	t.Parallel()

	const projectID = "projpartrev0003"
	const orgID = "orgpartrev00003"
	const targetUser = "xq9ndvc2kbrvrng"

	scenario := tests.ApiScenario{
		Name:           "admin can revoke a project participant",
		Method:         http.MethodDelete,
		URL:            "/api/v1/projects/" + projectID + "/participants/" + targetUser,
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Revoke Org 3", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			seedProjectParticipant(t, app, projectID, targetUser, "Editor")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			row, err := app.FindFirstRecordByFilter(
				"project_participants",
				"project = {:p} && user = {:u}",
				dbx.Params{"p": projectID, "u": targetUser},
			)
			if err != nil || row == nil {
				t.Fatalf("project_participants row missing: err=%v rec=%v", err, row)
			}
			if row.GetString("removed_at") == "" {
				t.Fatalf("removed_at not stamped after revoke")
			}
		},
	}

	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// POST /api/v1/projects/{projectID}/rotate
// ---------------------------------------------------------------------------

func TestProjectKeyRotateBumpsVersionAndPersistsNewKeys(t *testing.T) {
	t.Parallel()

	const projectID = "projrotate00001"
	const orgID = "orgrotate000001"

	scenario := tests.ApiScenario{
		Name:   "rotate bumps key_version and installs new wrappings + conversation keys",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/rotate",
		Body: strings.NewReader(`{
			"new_key_version": 2,
			"wrapped_project_keys": [
				{"user_id":"uvi8zmr78j9y5hz","wrapped_project_key":"JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ="}
			],
			"rewrapped_conversation_keys": []
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"project_id":"` + projectID + `"`,
			`"key_version":2`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Rotate Org", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			project, err := app.FindRecordById("projects", projectID)
			if err != nil {
				t.Fatalf("FindRecordById(projects) error = %v", err)
			}
			if got := project.GetInt("key_version"); got != 2 {
				t.Fatalf("projects.key_version = %d, want 2", got)
			}

			// New wrapping at v2 for the admin.
			wrapping, err := app.FindFirstRecordByFilter(
				"project_key_wrappings",
				"project = {:p} && user = {:u} && key_version = {:v}",
				dbx.Params{"p": projectID, "u": "uvi8zmr78j9y5hz", "v": 2},
			)
			if err != nil || wrapping == nil {
				t.Fatalf("missing v2 wrapping for admin: err=%v rec=%v", err, wrapping)
			}
			if got := wrapping.GetString("wrapped_project_key"); got != "JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ=" {
				t.Fatalf("v2 wrapping = %q, want new value", got)
			}
		},
	}

	scenario.Test(t)
}

func TestProjectKeyRotateRejectsNonAdmin(t *testing.T) {
	t.Parallel()

	const projectID = "projrotate00002"
	const orgID = "orgrotate000002"

	scenario := tests.ApiScenario{
		Name:   "Editor cannot rotate the project key",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/rotate",
		Body: strings.NewReader(`{
			"new_key_version": 2,
			"wrapped_project_keys": [
				{"user_id":"uvi8zmr78j9y5hz","wrapped_project_key":"x"}
			],
			"rewrapped_conversation_keys": []
		}`),
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`"message":"Only project admins can rotate the key."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Rotate Org 2", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			editor, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail = %v", err)
			}
			seedProjectParticipant(t, app, projectID, editor.Id, "Editor")
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			project, err := app.FindRecordById("projects", projectID)
			if err != nil {
				t.Fatalf("FindRecordById(projects) error = %v", err)
			}
			if got := project.GetInt("key_version"); got != 1 {
				t.Fatalf("projects.key_version = %d, want 1 (rotation must not have happened)", got)
			}
		},
	}

	scenario.Test(t)
}

func TestProjectKeyRotateRejectsWrongVersion(t *testing.T) {
	t.Parallel()

	const projectID = "projrotate00003"
	const orgID = "orgrotate000003"

	scenario := tests.ApiScenario{
		Name:   "rotate rejects new_key_version that is not current+1",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/rotate",
		Body: strings.NewReader(`{
			"new_key_version": 5,
			"wrapped_project_keys": [
				{"user_id":"uvi8zmr78j9y5hz","wrapped_project_key":"x"}
			],
			"rewrapped_conversation_keys": []
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"New_key_version must be current+1."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Rotate Org 3", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectKeyRotateRequiresFullParticipantCoverage(t *testing.T) {
	t.Parallel()

	const projectID = "projrotate00004"
	const orgID = "orgrotate000004"

	// Two active participants but only one wrapped_project_keys entry.
	scenario := tests.ApiScenario{
		Name:   "rotate rejects payload missing an active participant",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/rotate",
		Body: strings.NewReader(`{
			"new_key_version": 2,
			"wrapped_project_keys": [
				{"user_id":"uvi8zmr78j9y5hz","wrapped_project_key":"x"}
			],
			"rewrapped_conversation_keys": []
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Wrapped_project_keys must cover every active participant."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Rotate Org 4", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			seedProjectParticipant(t, app, projectID, "xq9ndvc2kbrvrng", "Editor")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectKeyRotateRequiresFullConversationCoverage(t *testing.T) {
	t.Parallel()

	const projectID = "projrotate00005"
	const orgID = "orgrotate000005"
	const conversationID = "projrotconv0001"

	// One project conversation but no rewrapped_conversation_keys entry.
	scenario := tests.ApiScenario{
		Name:   "rotate rejects payload missing a project conversation",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/rotate",
		Body: strings.NewReader(`{
			"new_key_version": 2,
			"wrapped_project_keys": [
				{"user_id":"uvi8zmr78j9y5hz","wrapped_project_key":"x"}
			],
			"rewrapped_conversation_keys": []
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Rewrapped_conversation_keys must cover every project conversation."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Rotate Org 5", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectKeyRotateRewrapsConversations(t *testing.T) {
	t.Parallel()

	const projectID = "projrotate00006"
	const orgID = "orgrotate000006"
	const conversationID = "projrotconv0002"

	scenario := tests.ApiScenario{
		Name:   "rotate rewraps project conversations under the new project key",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/rotate",
		Body: strings.NewReader(`{
			"new_key_version": 2,
			"wrapped_project_keys": [
				{"user_id":"uvi8zmr78j9y5hz","wrapped_project_key":"KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK="}
			],
			"rewrapped_conversation_keys": [
				{"conversation_id":"` + conversationID + `","wrapped_secret_key":"LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL="}
			]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"key_version":2`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Rotate Org 6", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			// New project_conversation_keys row at v2.
			row, err := app.FindFirstRecordByFilter(
				"project_conversation_keys",
				"project = {:p} && conversation = {:c} && project_key_version = {:v}",
				dbx.Params{"p": projectID, "c": conversationID, "v": 2},
			)
			if err != nil || row == nil {
				t.Fatalf("missing v2 project_conversation_keys row: err=%v rec=%v", err, row)
			}
			if got := row.GetString("wrapped_conversation_secret_key"); got != "LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL=" {
				t.Fatalf("wrapped_conversation_secret_key = %q, want rewrapped value", got)
			}
		},
	}

	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

func revokeProjectParticipant(t testing.TB, app *tests.TestApp, projectID, userID string) {
	t.Helper()

	record, err := app.FindFirstRecordByFilter(
		"project_participants",
		"project = {:p} && user = {:u}",
		map[string]any{"p": projectID, "u": userID},
	)
	if err != nil {
		t.Fatalf("FindFirstRecordByFilter(project_participants) error = %v", err)
	}
	if record == nil {
		t.Fatalf("FindFirstRecordByFilter(project_participants) = nil")
	}
	record.Set("removed_at", time.Now().UTC())
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(revoke) error = %v", err)
	}
}
