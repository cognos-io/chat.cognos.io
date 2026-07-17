package main

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// These tests pin the /api/v1/orgs surface (see docs/api-permissions.md):
// any authenticated Account can create an Organisation (becoming its owner
// member), and every read/update is gated by an ACTIVE org membership.
// Non-members and revoked members always get a neutral 404 so organisation
// ids cannot be probed; active members without a sufficient role get 403.

func TestOrganisationsRequireAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "orgs route requires record auth",
		Method:          http.MethodGet,
		URL:             "/api/v1/orgs",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

func TestOrganisationCreate(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "create organisation seeds the owner membership",
		Method:         http.MethodPost,
		URL:            "/api/v1/orgs",
		Body:           strings.NewReader(`{"name":"Acme GmbH"}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"name":"Acme GmbH"`,
			`"caller_role":"owner"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			org, err := app.FindFirstRecordByFilter(
				"organisations",
				"name = {:name}",
				dbx.Params{"name": "Acme GmbH"},
			)
			if err != nil || org == nil {
				t.Fatalf("organisation not created: err=%v record=%v", err, org)
			}

			user, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail = %v", err)
			}
			if got := org.GetString("owner"); got != user.Id {
				t.Fatalf("organisation owner = %q, want %q", got, user.Id)
			}

			membership, err := app.FindFirstRecordByFilter(
				"org_memberships",
				"organisation = {:o} && user = {:u}",
				dbx.Params{"o": org.Id, "u": user.Id},
			)
			if err != nil || membership == nil {
				t.Fatalf("owner membership not seeded: err=%v record=%v", err, membership)
			}
			if got := membership.GetString("role"); got != "owner" {
				t.Fatalf("owner membership role = %q, want %q", got, "owner")
			}
			if membership.GetString("added_at") == "" {
				t.Fatal("owner membership added_at is empty, want a timestamp")
			}
			if membership.GetString("removed_at") != "" {
				t.Fatalf("owner membership removed_at = %q, want empty (active)", membership.GetString("removed_at"))
			}
		},
	}

	scenario.Test(t)
}

func TestOrganisationCreateRejectsEmptyName(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "create organisation with missing name is rejected",
			Method:          http.MethodPost,
			URL:             "/api/v1/orgs",
			Body:            strings.NewReader(`{}`),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`Organisation name is required.`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
		},
		{
			Name:            "create organisation with whitespace-only name is rejected",
			Method:          http.MethodPost,
			URL:             "/api/v1/orgs",
			Body:            strings.NewReader(`{"name":"   "}`),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`Organisation name is required.`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
		},
		{
			Name:            "create organisation with an overlong name is rejected",
			Method:          http.MethodPost,
			URL:             "/api/v1/orgs",
			Body:            strings.NewReader(`{"name":"` + strings.Repeat("a", 200) + `"}`),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`validation_max_text_constraint`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestOrganisationListOnlyReturnsOwnOrganisations(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "list organisations only returns orgs with an active membership",
		Method:         http.MethodGet,
		URL:            "/api/v1/orgs",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"orgacme00000001"`,
			`"caller_role":"owner"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000001", "Acme GmbH", "test1@example.com")
			seedOrganisation(t, app, "orgother0000001", "Other AG", "test2@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			bodyBytes, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(response.Body) error = %v", err)
			}
			if strings.Contains(string(bodyBytes), `"id":"orgother0000001"`) {
				t.Fatalf("response body contains other user's organisation: %s", string(bodyBytes))
			}
		},
	}

	scenario.Test(t)
}

func TestOrganisationListReportsMemberRole(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "list organisations reports the caller's own role",
		Method:         http.MethodGet,
		URL:            "/api/v1/orgs",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"orgacme00000002"`,
			`"caller_role":"member"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000002", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgacme00000002", "test2@example.com", "member", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrganisationListExcludesRevokedMembership(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "list organisations excludes revoked memberships",
		Method:          http.MethodGet,
		URL:             "/api/v1/orgs",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`[]`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000003", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgacme00000003", "test2@example.com", "member", true)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			bodyBytes, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(response.Body) error = %v", err)
			}
			if strings.Contains(string(bodyBytes), `"id":"orgacme00000003"`) {
				t.Fatalf("response body contains revoked membership's organisation: %s", string(bodyBytes))
			}
		},
	}

	scenario.Test(t)
}

func TestOrganisationGet(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "get organisation as an active member",
		Method:         http.MethodGet,
		URL:            "/api/v1/orgs/orgacme00000004",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"orgacme00000004"`,
			`"name":"Acme GmbH"`,
			`"caller_role":"member"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000004", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgacme00000004", "test2@example.com", "member", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrganisationGetNonMemberReturnsNotFound(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "get organisation as a non-member returns not found",
		Method:          http.MethodGet,
		URL:             "/api/v1/orgs/orgacme00000005",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Organisation not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000005", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrganisationGetRevokedMemberReturnsNotFound(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "get organisation as a revoked member returns not found",
		Method:          http.MethodGet,
		URL:             "/api/v1/orgs/orgacme00000006",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Organisation not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000006", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgacme00000006", "test2@example.com", "member", true)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrganisationGetMissingReturnsNotFound(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "get missing organisation returns not found",
		Method:          http.MethodGet,
		URL:             "/api/v1/orgs/doesnotexist001",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Organisation not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestOrganisationUpdateAsOwner(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "owner renames the organisation",
		Method:         http.MethodPatch,
		URL:            "/api/v1/orgs/orgacme00000007",
		Body:           strings.NewReader(`{"name":"Acme Holdings"}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"orgacme00000007"`,
			`"name":"Acme Holdings"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000007", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			org, err := app.FindRecordById("organisations", "orgacme00000007")
			if err != nil {
				t.Fatalf("FindRecordById(organisations) error = %v", err)
			}
			if got := org.GetString("name"); got != "Acme Holdings" {
				t.Fatalf("organisation name = %q, want %q", got, "Acme Holdings")
			}
		},
	}

	scenario.Test(t)
}

func TestOrganisationUpdateAsAdmin(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "admin renames the organisation",
		Method:         http.MethodPatch,
		URL:            "/api/v1/orgs/orgacme00000008",
		Body:           strings.NewReader(`{"name":"Acme Renamed"}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"name":"Acme Renamed"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000008", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgacme00000008", "test2@example.com", "admin", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrganisationUpdateAsMemberForbidden(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "member (non-admin) cannot rename the organisation",
		Method:          http.MethodPatch,
		URL:             "/api/v1/orgs/orgacme00000009",
		Body:            strings.NewReader(`{"name":"Hijack"}`),
		ExpectedStatus:  http.StatusForbidden,
		ExpectedContent: []string{`"message":"Only organisation owners and admins can update the organisation."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000009", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgacme00000009", "test2@example.com", "member", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			org, err := app.FindRecordById("organisations", "orgacme00000009")
			if err != nil {
				t.Fatalf("FindRecordById(organisations) error = %v", err)
			}
			if got := org.GetString("name"); got != "Acme GmbH" {
				t.Fatalf("organisation name = %q, want unchanged %q", got, "Acme GmbH")
			}
		},
	}

	scenario.Test(t)
}

func TestOrganisationUpdateNonMemberReturnsNotFound(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "non-member cannot rename the organisation",
		Method:          http.MethodPatch,
		URL:             "/api/v1/orgs/orgacme00000010",
		Body:            strings.NewReader(`{"name":"Hijack"}`),
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Organisation not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000010", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrganisationUpdateRevokedAdminReturnsNotFound(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "revoked admin cannot rename the organisation",
		Method:          http.MethodPatch,
		URL:             "/api/v1/orgs/orgacme00000011",
		Body:            strings.NewReader(`{"name":"Hijack"}`),
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Organisation not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000011", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgacme00000011", "test2@example.com", "admin", true)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrganisationUpdateRejectsEmptyName(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "rename with an empty name is rejected",
		Method:          http.MethodPatch,
		URL:             "/api/v1/orgs/orgacme00000012",
		Body:            strings.NewReader(`{"name":"  "}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{`Organisation name is required.`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000012", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrganisationMembersList(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "active member lists the organisation members with roles",
		Method:         http.MethodGet,
		URL:            "/api/v1/orgs/orgacme00000013/members",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"user":"uvi8zmr78j9y5hz"`,
			`"role":"owner"`,
			`"user":"xq9ndvc2kbrvrng"`,
			`"role":"member"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000013", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgacme00000013", "test2@example.com", "member", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrganisationMembersListExcludesRevoked(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "members list excludes revoked memberships",
		Method:         http.MethodGet,
		URL:            "/api/v1/orgs/orgacme00000014/members",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"user":"uvi8zmr78j9y5hz"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000014", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgacme00000014", "test2@example.com", "member", true)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			bodyBytes, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(response.Body) error = %v", err)
			}
			if strings.Contains(string(bodyBytes), `"user":"xq9ndvc2kbrvrng"`) {
				t.Fatalf("response body contains revoked member: %s", string(bodyBytes))
			}
		},
	}

	scenario.Test(t)
}

func TestOrganisationMembersListNonMemberReturnsNotFound(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "non-member cannot list the organisation members",
		Method:          http.MethodGet,
		URL:             "/api/v1/orgs/orgacme00000015/members",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Organisation not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000015", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrganisationMembersListRevokedMemberReturnsNotFound(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "revoked member cannot list the organisation members",
		Method:          http.MethodGet,
		URL:             "/api/v1/orgs/orgacme00000016/members",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Organisation not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgacme00000016", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgacme00000016", "test2@example.com", "member", true)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

// TestOrganisationRevokedOwnerReturnsNotFound pins that access gates on the
// org_memberships rows, NOT on organisations.owner: even the Account named in
// the owner field is locked out with a neutral 404 once their membership row
// is soft-revoked.
func TestOrganisationRevokedOwnerReturnsNotFound(t *testing.T) {
	t.Parallel()

	seedWithRevokedOwner := func(orgID string) func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		return func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Acme GmbH", "test1@example.com")
			revokeOrgMembership(t, app, orgID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		}
	}

	scenarios := []tests.ApiScenario{
		{
			Name:            "revoked owner cannot get the organisation",
			Method:          http.MethodGet,
			URL:             "/api/v1/orgs/orgacme00000018",
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"message":"Organisation not found."`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seedWithRevokedOwner("orgacme00000018"),
		},
		{
			Name:            "revoked owner cannot rename the organisation",
			Method:          http.MethodPatch,
			URL:             "/api/v1/orgs/orgacme00000019",
			Body:            strings.NewReader(`{"name":"Hijack"}`),
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"message":"Organisation not found."`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seedWithRevokedOwner("orgacme00000019"),
		},
		{
			Name:            "revoked owner cannot list the organisation members",
			Method:          http.MethodGet,
			URL:             "/api/v1/orgs/orgacme00000020/members",
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"message":"Organisation not found."`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  seedWithRevokedOwner("orgacme00000020"),
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

// TestOrgMembershipReactivation pins the intended revoke→re-add semantics:
// because of the unique (organisation, user) index a re-add can never insert
// a second row — it must clear removed_at on the existing row, which
// reactivates the membership for every access check.
func TestOrgMembershipReactivation(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	seedOrganisation(t, app, "orgacme00000021", "Acme GmbH", "test1@example.com")
	seedOrgMembership(t, app, "orgacme00000021", "test2@example.com", "member", true)

	repo := organisations.NewPocketBaseRepo(app)

	active, err := repo.IsActiveMember("orgacme00000021", "xq9ndvc2kbrvrng")
	if err != nil {
		t.Fatalf("IsActiveMember(revoked) error = %v", err)
	}
	if active {
		t.Fatal("IsActiveMember(revoked) = true, want false")
	}

	// Re-add = reactivate the existing row (an insert would violate the
	// unique index — pinned by TestOrgMembershipUniquePerUser).
	membership, err := app.FindFirstRecordByFilter(
		"org_memberships",
		"organisation = {:o} && user = {:u}",
		dbx.Params{"o": "orgacme00000021", "u": "xq9ndvc2kbrvrng"},
	)
	if err != nil {
		t.Fatalf("FindFirstRecordByFilter(org_memberships) error = %v", err)
	}
	membership.Set("removed_at", "")
	if err := app.Save(membership); err != nil {
		t.Fatalf("Save(reactivated membership) error = %v", err)
	}

	active, err = repo.IsActiveMember("orgacme00000021", "xq9ndvc2kbrvrng")
	if err != nil {
		t.Fatalf("IsActiveMember(reactivated) error = %v", err)
	}
	if !active {
		t.Fatal("IsActiveMember(reactivated) = false, want true")
	}

	role, ok, err := repo.ActiveRole("orgacme00000021", "xq9ndvc2kbrvrng")
	if err != nil || !ok {
		t.Fatalf("ActiveRole(reactivated) = %q, %v, %v; want role, true, nil", role, ok, err)
	}
	if role != organisations.RoleMember {
		t.Fatalf("ActiveRole(reactivated) = %q, want %q", role, organisations.RoleMember)
	}
}

// TestOrgMembershipUniquePerUser pins the unique (organisation, user) index:
// a second membership row for the same pair must be rejected at the schema
// level, so a revoke+re-add flow has to reactivate the existing row rather
// than accumulate duplicates.
func TestOrgMembershipUniquePerUser(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	seedOrganisation(t, app, "orgacme00000017", "Acme GmbH", "test1@example.com")

	collection, err := app.FindCollectionByNameOrId("org_memberships")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(org_memberships) error = %v", err)
	}

	// The owner membership row already exists via seedOrganisation.
	duplicate := core.NewRecord(collection)
	duplicate.Set("organisation", "orgacme00000017")
	duplicate.Set("user", "uvi8zmr78j9y5hz")
	duplicate.Set("role", "member")
	duplicate.Set("added_at", time.Now().UTC())
	if err := app.Save(duplicate); err == nil {
		t.Fatal("Save(duplicate org membership) error = nil, want unique index violation")
	}
}

// TestOrganisationCollectionRulesAreLocked pins the same stance as the chat
// and project collections: every organisation collection rule is nil so the
// /api/collections/* surface rejects all callers and access flows only
// through the /api/v1/orgs handlers, which authorise in Go.
func TestOrganisationCollectionRulesAreLocked(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	for _, name := range []string{"organisations", "org_memberships"} {
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

// TestOrganisationCollectionRoutesLocked probes the locked collections over
// HTTP in the style of filter_rules_test.go: both guests and authenticated
// users are denied on the built-in /api/collections surface.
func TestOrganisationCollectionRoutesLocked(t *testing.T) {
	t.Parallel()

	for _, collectionName := range []string{"organisations", "org_memberships"} {
		scenarios := []tests.ApiScenario{
			{
				Name:            "list " + collectionName + " as guest is denied",
				Method:          http.MethodGet,
				URL:             "/api/collections/" + collectionName + "/records",
				ExpectedStatus:  http.StatusForbidden,
				ExpectedContent: []string{`"data":{}`},
				TestAppFactory:  setupTestApp,
			},
			{
				Name:            "list " + collectionName + " via user token is denied",
				Method:          http.MethodGet,
				URL:             "/api/collections/" + collectionName + "/records",
				ExpectedStatus:  http.StatusForbidden,
				ExpectedContent: []string{`"data":{}`},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
			},
			{
				Name:            "create " + collectionName + " via user token is denied",
				Method:          http.MethodPost,
				URL:             "/api/collections/" + collectionName + "/records",
				Body:            strings.NewReader(`{}`),
				ExpectedStatus:  http.StatusForbidden,
				ExpectedContent: []string{`"data":{}`},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
			},
		}

		for _, scenario := range scenarios {
			scenario.Test(t)
		}
	}
}

// seedOrganisation creates an organisation owned by ownerEmail and, mirroring
// the production create handler, the owner's active membership row.
func seedOrganisation(t testing.TB, app *tests.TestApp, orgID, name, ownerEmail string) {
	t.Helper()

	userRecord, err := app.FindAuthRecordByEmail("users", ownerEmail)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", ownerEmail, err)
	}

	collection, err := app.FindCollectionByNameOrId("organisations")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(organisations) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Id = orgID
	record.Set("name", name)
	record.Set("owner", userRecord.Id)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(organisationRecord) error = %v", err)
	}

	seedOrgMembership(t, app, orgID, ownerEmail, "owner", false)
}

// revokeOrgMembership soft-revokes an existing membership row by stamping
// removed_at — the row survives as audit data but must be treated as
// inactive by every access check.
func revokeOrgMembership(t testing.TB, app *tests.TestApp, orgID, userEmail string) {
	t.Helper()

	userRecord, err := app.FindAuthRecordByEmail("users", userEmail)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", userEmail, err)
	}

	record, err := app.FindFirstRecordByFilter(
		"org_memberships",
		"organisation = {:o} && user = {:u}",
		dbx.Params{"o": orgID, "u": userRecord.Id},
	)
	if err != nil {
		t.Fatalf("FindFirstRecordByFilter(org_memberships) error = %v", err)
	}

	record.Set("removed_at", time.Now().UTC())
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(revoked orgMembershipRecord) error = %v", err)
	}
}

// seedOrgMembership adds an org membership row; revoked stamps removed_at so
// the row exists but must be treated as inactive by every access check.
func seedOrgMembership(t testing.TB, app *tests.TestApp, orgID, userEmail, role string, revoked bool) {
	t.Helper()

	userRecord, err := app.FindAuthRecordByEmail("users", userEmail)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", userEmail, err)
	}

	collection, err := app.FindCollectionByNameOrId("org_memberships")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(org_memberships) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Set("organisation", orgID)
	record.Set("user", userRecord.Id)
	record.Set("role", role)
	record.Set("added_at", time.Now().UTC())
	if revoked {
		record.Set("removed_at", time.Now().UTC())
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(orgMembershipRecord) error = %v", err)
	}
}
