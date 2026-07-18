package main

// Content-free organisation audit log + admin session revocation
// (docs/specs/organisations.md §11 Phase 2).
//
// These tests pin three properties:
//
//  1. access — only org owners/admins can read the audit log, export it,
//     or revoke a member's sessions; members get 403 and non-members get a
//     neutral 404;
//  2. coverage — every instrumented org mutation writes exactly one audit
//     row with a dot-namespaced action and an opaque target id;
//  3. content-freedom — no audit row ever contains an email address or a
//     base64 data blob (regex pin over every stored action/target).

import (
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
)

const (
	auditTestUser1ID = "uvi8zmr78j9y5hz" // test1@example.com
	auditTestUser2ID = "xq9ndvc2kbrvrng" // test2@example.com
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// seedOrgAuditEvent inserts an audit row directly, then forces the created
// timestamp via raw SQL (bypassing the autodate) so ordering is deterministic.
func seedOrgAuditEvent(t testing.TB, app *tests.TestApp, orgID, actorID, action, target string, created time.Time) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("org_audit_events")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(org_audit_events) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Set("organisation", orgID)
	record.Set("actor", actorID)
	record.Set("action", action)
	record.Set("target", target)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(orgAuditEventRecord) error = %v", err)
	}

	if _, err := app.DB().Update(
		"org_audit_events",
		dbx.Params{"created": created.UTC().Format("2006-01-02 15:04:05.000Z")},
		dbx.HashExp{"id": record.Id},
	).Execute(); err != nil {
		t.Fatalf("force created timestamp error = %v", err)
	}
}

// findOrgAuditEvents returns all audit rows for an organisation.
func findOrgAuditEvents(t testing.TB, app *tests.TestApp, orgID string) []*core.Record {
	t.Helper()

	records, err := app.FindRecordsByFilter(
		"org_audit_events",
		"organisation = {:org}",
		"-created", 0, 0,
		dbx.Params{"org": orgID},
	)
	if err != nil {
		t.Fatalf("FindRecordsByFilter(org_audit_events) error = %v", err)
	}
	return records
}

// requireAuditEvent asserts exactly one audit row with the given action
// exists for the organisation and returns it.
func requireAuditEvent(t testing.TB, app *tests.TestApp, orgID, action string) *core.Record {
	t.Helper()

	var matches []*core.Record
	for _, r := range findOrgAuditEvents(t, app, orgID) {
		if r.GetString("action") == action {
			matches = append(matches, r)
		}
	}
	if len(matches) != 1 {
		t.Fatalf("audit rows with action %q = %d, want exactly 1", action, len(matches))
	}
	return matches[0]
}

// base64BlobPattern matches long unbroken base64-ish runs — the shape of a
// wrapped key or encrypted payload. Record ids (15 chars) and compound
// "id:id" targets never match.
var base64BlobPattern = regexp.MustCompile(`[A-Za-z0-9+/]{32,}={0,2}`)

// assertAuditRowsContentFree pins the content-freedom guarantee: no stored
// action or target may contain an email address or a base64 data blob.
func assertAuditRowsContentFree(t testing.TB, app *tests.TestApp, orgID string) {
	t.Helper()

	for _, r := range findOrgAuditEvents(t, app, orgID) {
		for _, field := range []string{"action", "target"} {
			value := r.GetString(field)
			if strings.Contains(value, "@") {
				t.Errorf("audit row %s %s = %q contains an email address", r.Id, field, value)
			}
			if base64BlobPattern.MatchString(value) {
				t.Errorf("audit row %s %s = %q contains a base64 data blob", r.Id, field, value)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Collection rules
// ---------------------------------------------------------------------------

func TestOrgAuditCollectionRulesAreLocked(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	collection, err := app.FindCollectionByNameOrId("org_audit_events")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(org_audit_events) error = %v", err)
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
			t.Errorf("org_audit_events.%s rule = %q, want nil (locked)", op, *rule)
		}
	}
}

// ---------------------------------------------------------------------------
// GET /orgs/{id}/audit — role gates
// ---------------------------------------------------------------------------

func TestOrgAuditListRoleGates(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		orgID      string
		seed       func(t testing.TB, app *tests.TestApp, e *core.ServeEvent)
		authEmail  string
		wantStatus int
		wantBody   string
	}{
		{
			name:  "owner can list audit events",
			orgID: "orgaudit0000001",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgaudit0000001", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test1@example.com",
			wantStatus: http.StatusOK,
			wantBody:   `"items"`,
		},
		{
			name:  "admin can list audit events",
			orgID: "orgaudit0000002",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgaudit0000002", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgaudit0000002", "test2@example.com", "admin", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusOK,
			wantBody:   `"items"`,
		},
		{
			name:  "member cannot list audit events",
			orgID: "orgaudit0000003",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgaudit0000003", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgaudit0000003", "test2@example.com", "member", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
			wantBody:   `"message"`,
		},
		{
			name:  "non-member gets neutral 404",
			orgID: "orgaudit0000004",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgaudit0000004", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusNotFound,
			wantBody:   `"message":"Organisation not found."`,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			s := tests.ApiScenario{
				Name:            c.name,
				Method:          http.MethodGet,
				URL:             "/api/v1/orgs/" + c.orgID + "/audit",
				ExpectedStatus:  c.wantStatus,
				ExpectedContent: []string{c.wantBody},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					c.seed(t, app, e)
					withRecordAuth("users", c.authEmail)(t, app, e)
				},
			}
			s.Test(t)
		})
	}
}

func TestOrgAuditListNewestFirstAndPaginated(t *testing.T) {
	t.Parallel()

	base := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)

	scenario := tests.ApiScenario{
		Name:           "audit list returns newest first with pagination metadata",
		Method:         http.MethodGet,
		URL:            "/api/v1/orgs/orgaudit0000005/audit?page=1&page_size=2",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"page":1`,
			`"perPage":2`,
			`"totalItems":3`,
			`"totalPages":2`,
			`"action":"org.policies.updated"`,
		},
		NotExpectedContent: []string{
			// The oldest event falls on page 2.
			`"action":"org.invite.created"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgaudit0000005", "Acme GmbH", "test1@example.com")
			seedOrgAuditEvent(t, app, "orgaudit0000005", auditTestUser1ID, "org.invite.created", "invite000000001", base)
			seedOrgAuditEvent(t, app, "orgaudit0000005", auditTestUser1ID, "org.member.offboarded", auditTestUser2ID, base.Add(time.Minute))
			seedOrgAuditEvent(t, app, "orgaudit0000005", auditTestUser1ID, "org.policies.updated", "", base.Add(2*time.Minute))
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// GET /orgs/{id}/audit/export — role gates + CSV shape
// ---------------------------------------------------------------------------

func TestOrgAuditExportRoleGates(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		orgID      string
		seed       func(t testing.TB, app *tests.TestApp, e *core.ServeEvent)
		authEmail  string
		wantStatus int
		wantBody   string
	}{
		{
			name:  "owner can export audit events",
			orgID: "orgaudit0000006",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgaudit0000006", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test1@example.com",
			wantStatus: http.StatusOK,
			wantBody:   "created,action,actor,target",
		},
		{
			name:  "member cannot export audit events",
			orgID: "orgaudit0000007",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgaudit0000007", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgaudit0000007", "test2@example.com", "member", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
			wantBody:   `"message"`,
		},
		{
			name:  "non-member gets neutral 404",
			orgID: "orgaudit0000008",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgaudit0000008", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusNotFound,
			wantBody:   `"message":"Organisation not found."`,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			s := tests.ApiScenario{
				Name:            c.name,
				Method:          http.MethodGet,
				URL:             "/api/v1/orgs/" + c.orgID + "/audit/export",
				ExpectedStatus:  c.wantStatus,
				ExpectedContent: []string{c.wantBody},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					c.seed(t, app, e)
					withRecordAuth("users", c.authEmail)(t, app, e)
				},
			}
			s.Test(t)
		})
	}
}

func TestOrgAuditExportCSV(t *testing.T) {
	t.Parallel()

	base := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)

	scenario := tests.ApiScenario{
		Name:           "audit export is a CSV attachment with created,action,actor,target rows",
		Method:         http.MethodGet,
		URL:            "/api/v1/orgs/orgaudit0000009/audit/export",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			"created,action,actor,target",
			"org.member.offboarded",
			auditTestUser2ID,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgaudit0000009", "Acme GmbH", "test1@example.com")
			seedOrgAuditEvent(t, app, "orgaudit0000009", auditTestUser1ID, "org.member.offboarded", auditTestUser2ID, base)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			contentType := res.Header.Get("Content-Type")
			if !strings.HasPrefix(contentType, "text/csv") {
				t.Errorf("Content-Type = %q, want text/csv", contentType)
			}
			disposition := res.Header.Get("Content-Disposition")
			if !strings.Contains(disposition, "attachment") {
				t.Errorf("Content-Disposition = %q, want an attachment", disposition)
			}
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("read body error = %v", err)
			}
			lines := strings.Split(strings.TrimSpace(string(body)), "\n")
			if len(lines) != 2 {
				t.Fatalf("CSV line count = %d, want 2 (header + 1 row)", len(lines))
			}
			row := strings.Split(strings.TrimSpace(lines[1]), ",")
			if len(row) != 4 {
				t.Fatalf("CSV row column count = %d, want 4 (created,action,actor,target)", len(row))
			}
			if row[1] != "org.member.offboarded" {
				t.Errorf("CSV action column = %q, want org.member.offboarded", row[1])
			}
			if row[2] != auditTestUser1ID {
				t.Errorf("CSV actor column = %q, want %q", row[2], auditTestUser1ID)
			}
			if row[3] != auditTestUser2ID {
				t.Errorf("CSV target column = %q, want %q", row[3], auditTestUser2ID)
			}
		},
	}
	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// Audit rows written by instrumented mutations
// ---------------------------------------------------------------------------

func TestOrgAuditEventRecordedOnInviteCreate(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "invite create records org.invite.created with the invite row id (never the email)",
		Method:          http.MethodPost,
		URL:             "/api/v1/orgs/orgaudit0000010/invites",
		Body:            strings.NewReader(`{"email":"invited@example.com","role":"member"}`),
		ExpectedStatus:  http.StatusCreated,
		ExpectedContent: []string{`"id"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgaudit0000010", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			event := requireAuditEvent(t, app, "orgaudit0000010", "org.invite.created")
			invite, err := app.FindFirstRecordByFilter(
				"org_invites",
				"organisation = {:org}",
				dbx.Params{"org": "orgaudit0000010"},
			)
			if err != nil {
				t.Fatalf("FindFirstRecordByFilter(org_invites) error = %v", err)
			}
			if got := event.GetString("target"); got != invite.Id {
				t.Errorf("audit target = %q, want invite row id %q", got, invite.Id)
			}
			if got := event.GetString("actor"); got != auditTestUser1ID {
				t.Errorf("audit actor = %q, want %q", got, auditTestUser1ID)
			}
			assertAuditRowsContentFree(t, app, "orgaudit0000010")
		},
	}
	scenario.Test(t)
}

func TestOrgAuditEventRecordedOnInviteRevoke(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "invite revoke records org.invite.revoked",
		Method:         http.MethodDelete,
		URL:            "/api/v1/orgs/orgaudit0000011/invites/orgauditinv0001",
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgaudit0000011", "Acme GmbH", "test1@example.com")
			seedOrgInviteWithID(t, app, "orgauditinv0001", "orgaudit0000011", "invited@example.com", "member", "audit-revoke-token", time.Now().UTC().Add(time.Hour), false)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			event := requireAuditEvent(t, app, "orgaudit0000011", "org.invite.revoked")
			if got := event.GetString("target"); got != "orgauditinv0001" {
				t.Errorf("audit target = %q, want invite row id orgauditinv0001", got)
			}
			assertAuditRowsContentFree(t, app, "orgaudit0000011")
		},
	}
	scenario.Test(t)
}

func TestOrgAuditEventRecordedOnInviteAccept(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "invite accept records org.invite.accepted with the accepting user as actor",
		Method:          http.MethodPost,
		URL:             "/api/v1/org-invites/accept",
		Body:            strings.NewReader(`{"token":"audit-accept-token"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"organisation"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgaudit0000012", "Acme GmbH", "test1@example.com")
			seedOrgInviteWithID(t, app, "orgauditinv0002", "orgaudit0000012", "test2@example.com", "member", "audit-accept-token", time.Now().UTC().Add(time.Hour), false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			event := requireAuditEvent(t, app, "orgaudit0000012", "org.invite.accepted")
			if got := event.GetString("actor"); got != auditTestUser2ID {
				t.Errorf("audit actor = %q, want accepting user %q", got, auditTestUser2ID)
			}
			if got := event.GetString("target"); got != "orgauditinv0002" {
				t.Errorf("audit target = %q, want invite row id orgauditinv0002", got)
			}
			assertAuditRowsContentFree(t, app, "orgaudit0000012")
		},
	}
	scenario.Test(t)
}

func TestOrgAuditEventRecordedOnOffboard(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "member offboard records org.member.offboarded",
		Method:          http.MethodDelete,
		URL:             "/api/v1/orgs/orgaudit0000013/members/" + auditTestUser2ID,
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"rotation_project_ids":[]`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgaudit0000013", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgaudit0000013", "test2@example.com", "member", false)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			event := requireAuditEvent(t, app, "orgaudit0000013", "org.member.offboarded")
			if got := event.GetString("target"); got != auditTestUser2ID {
				t.Errorf("audit target = %q, want offboarded user id %q", got, auditTestUser2ID)
			}
			assertAuditRowsContentFree(t, app, "orgaudit0000013")
		},
	}
	scenario.Test(t)
}

func TestOrgAuditEventRecordedOnPoliciesUpdate(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "policies update records org.policies.updated",
		Method:          http.MethodPatch,
		URL:             "/api/v1/orgs/orgaudit0000014/policies",
		Body:            strings.NewReader(`{"policy_mfa_required":true}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"policy_mfa_required":true`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgaudit0000014", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			requireAuditEvent(t, app, "orgaudit0000014", "org.policies.updated")
			assertAuditRowsContentFree(t, app, "orgaudit0000014")
		},
	}
	scenario.Test(t)
}

func TestOrgAuditEventRecordedOnBillingCheckout(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "billing checkout records org.billing.checkout_started",
		Method:          http.MethodPost,
		URL:             "/api/v1/orgs/orgaudit0000015/billing/checkout",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"checkout_url"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				Config: &config.APIConfig{
					InfomaniakAPIKey:     "test-infomaniak-key",
					InfomaniakProductID:  "test-product-id",
					RequestyAPIKey:       "test-requesty-key",
					MFATOTPEncryptionKey: testMFAKeyB64,
					PaddlePriceOrgSeat:   "pri_org_seat_test",
				},
				PaddleClient: &fakeOrgPaddleClient{checkoutURL: "https://sandbox.paddle.test/checkout"},
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgaudit0000015", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			requireAuditEvent(t, app, "orgaudit0000015", "org.billing.checkout_started")
			assertAuditRowsContentFree(t, app, "orgaudit0000015")
		},
	}
	scenario.Test(t)
}

func TestOrgAuditEventRecordedOnParticipantAdd(t *testing.T) {
	t.Parallel()

	// The wrapped key is a base64 blob — the pin below proves it never
	// leaks into the audit row.
	body := `{"user_id":"` + auditTestUser2ID + `","role":"Editor","wrapped_project_key":"` +
		strings.Repeat("QWJjZDEyMzQ", 4) + `"}`

	scenario := tests.ApiScenario{
		Name:            "project participant add records org.project.participant_added",
		Method:          http.MethodPost,
		URL:             "/api/v1/projects/orgauditproj001/participants",
		Body:            strings.NewReader(body),
		ExpectedStatus:  http.StatusCreated,
		ExpectedContent: []string{`"user_id"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgaudit0000016", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgaudit0000016", "test2@example.com", "member", false)
			seedOrgOwnedProject(t, app, "orgauditproj001", "orgaudit0000016", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			event := requireAuditEvent(t, app, "orgaudit0000016", "org.project.participant_added")
			want := "orgauditproj001:" + auditTestUser2ID
			if got := event.GetString("target"); got != want {
				t.Errorf("audit target = %q, want %q", got, want)
			}
			assertAuditRowsContentFree(t, app, "orgaudit0000016")
		},
	}
	scenario.Test(t)
}

func TestOrgAuditEventRecordedOnParticipantRevoke(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "project participant revoke records org.project.participant_revoked",
		Method:         http.MethodDelete,
		URL:            "/api/v1/projects/orgauditproj002/participants/" + auditTestUser2ID,
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgaudit0000017", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orgaudit0000017", "test2@example.com", "member", false)
			seedOrgOwnedProject(t, app, "orgauditproj002", "orgaudit0000017", "test1@example.com")
			seedProjectParticipant(t, app, "orgauditproj002", auditTestUser2ID, "Editor")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			event := requireAuditEvent(t, app, "orgaudit0000017", "org.project.participant_revoked")
			want := "orgauditproj002:" + auditTestUser2ID
			if got := event.GetString("target"); got != want {
				t.Errorf("audit target = %q, want %q", got, want)
			}
			assertAuditRowsContentFree(t, app, "orgaudit0000017")
		},
	}
	scenario.Test(t)
}

func TestOrgAuditEventRecordedOnProjectRotate(t *testing.T) {
	t.Parallel()

	body := `{"new_key_version":2,"wrapped_project_keys":[{"user_id":"` + auditTestUser1ID +
		`","wrapped_project_key":"NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN="}],"rewrapped_conversation_keys":[]}`

	scenario := tests.ApiScenario{
		Name:            "project key rotation records org.project.rotated",
		Method:          http.MethodPost,
		URL:             "/api/v1/projects/orgauditproj003/rotate",
		Body:            strings.NewReader(body),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"key_version":2`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orgaudit0000018", "Acme GmbH", "test1@example.com")
			seedOrgOwnedProject(t, app, "orgauditproj003", "orgaudit0000018", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			event := requireAuditEvent(t, app, "orgaudit0000018", "org.project.rotated")
			if got := event.GetString("target"); got != "orgauditproj003" {
				t.Errorf("audit target = %q, want project id orgauditproj003", got)
			}
			assertAuditRowsContentFree(t, app, "orgaudit0000018")
		},
	}
	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// POST /orgs/{id}/members/{userId}/revoke-sessions
// ---------------------------------------------------------------------------

func TestOrgRevokeSessionsRoleGates(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		orgID      string
		targetID   string
		seed       func(t testing.TB, app *tests.TestApp, e *core.ServeEvent)
		authEmail  string
		wantStatus int
	}{
		{
			name:     "owner can revoke a member's sessions",
			orgID:    "orgsess00000001",
			targetID: auditTestUser2ID,
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgsess00000001", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgsess00000001", "test2@example.com", "member", false)
			},
			authEmail:  "test1@example.com",
			wantStatus: http.StatusNoContent,
		},
		{
			name:     "admin can revoke a member's sessions",
			orgID:    "orgsess00000002",
			targetID: "j8prcx3dum2l3kc",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgsess00000002", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgsess00000002", "test2@example.com", "admin", false)
				seedOrgMembership(t, app, "orgsess00000002", "no_data@example.com", "member", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusNoContent,
		},
		{
			name:     "admin cannot revoke the owner's sessions",
			orgID:    "orgsess00000003",
			targetID: auditTestUser1ID,
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgsess00000003", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgsess00000003", "test2@example.com", "admin", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
		},
		{
			name:     "member cannot revoke sessions",
			orgID:    "orgsess00000004",
			targetID: auditTestUser1ID,
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgsess00000004", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgsess00000004", "test2@example.com", "member", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
		},
		{
			name:     "non-member gets neutral 404",
			orgID:    "orgsess00000005",
			targetID: auditTestUser1ID,
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgsess00000005", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusNotFound,
		},
		{
			name:     "target must be an active member",
			orgID:    "orgsess00000006",
			targetID: auditTestUser2ID,
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orgsess00000006", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orgsess00000006", "test2@example.com", "member", true)
			},
			authEmail:  "test1@example.com",
			wantStatus: http.StatusNotFound,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			var expectedContent []string
			if c.wantStatus != http.StatusNoContent {
				expectedContent = []string{`"message"`}
			}
			s := tests.ApiScenario{
				Name:            c.name,
				Method:          http.MethodPost,
				URL:             "/api/v1/orgs/" + c.orgID + "/members/" + c.targetID + "/revoke-sessions",
				ExpectedStatus:  c.wantStatus,
				ExpectedContent: expectedContent,
				TestAppFactory:  setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					c.seed(t, app, e)
					withRecordAuth("users", c.authEmail)(t, app, e)
				},
				AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
					events := findOrgAuditEvents(t, app, c.orgID)
					if c.wantStatus == http.StatusNoContent {
						event := requireAuditEvent(t, app, c.orgID, "org.member.sessions_revoked")
						if got := event.GetString("target"); got != c.targetID {
							t.Errorf("audit target = %q, want %q", got, c.targetID)
						}
						assertAuditRowsContentFree(t, app, c.orgID)
					} else if len(events) != 0 {
						t.Errorf("audit rows after denied request = %d, want 0", len(events))
					}
				},
			}
			s.Test(t)
		})
	}
}

// TestOrgRevokeSessionsInvalidatesExistingTokens drives the real HTTP surface
// end to end: the member authenticates with a real auth token, an admin
// revokes their sessions, and the previously-valid token is rejected with 401.
// The admin's own token stays valid — only the target's tokenKey rotated.
func TestOrgRevokeSessionsInvalidatesExistingTokens(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	defer app.Cleanup()

	seedOrganisation(t, app, "orgsess00000007", "Acme GmbH", "test1@example.com")
	seedOrgMembership(t, app, "orgsess00000007", "test2@example.com", "member", false)

	admin, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(test1) error = %v", err)
	}
	member, err := app.FindAuthRecordByEmail("users", "test2@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(test2) error = %v", err)
	}

	adminToken, err := admin.NewAuthToken()
	if err != nil {
		t.Fatalf("admin.NewAuthToken() error = %v", err)
	}
	memberToken, err := member.NewAuthToken()
	if err != nil {
		t.Fatalf("member.NewAuthToken() error = %v", err)
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

		do := func(method, url, token string) int {
			req := httptest.NewRequest(method, url, nil)
			req.Header.Set("content-type", "application/json")
			if token != "" {
				req.Header.Set("Authorization", token)
			}
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			return rec.Code
		}

		// Sanity: the member's token authenticates before revocation.
		if got := do(http.MethodGet, "/api/v1/orgs", memberToken); got != http.StatusOK {
			t.Fatalf("pre-revocation member request status = %d, want 200", got)
		}

		// Admin revokes the member's sessions.
		if got := do(http.MethodPost, "/api/v1/orgs/orgsess00000007/members/"+auditTestUser2ID+"/revoke-sessions", adminToken); got != http.StatusNoContent {
			t.Fatalf("revoke-sessions status = %d, want 204", got)
		}

		// The old member token is now rejected.
		if got := do(http.MethodGet, "/api/v1/orgs", memberToken); got != http.StatusUnauthorized {
			t.Errorf("post-revocation member request status = %d, want 401", got)
		}

		// The admin's own token is untouched.
		if got := do(http.MethodGet, "/api/v1/orgs", adminToken); got != http.StatusOK {
			t.Errorf("post-revocation admin request status = %d, want 200", got)
		}

		return nil
	}); err != nil {
		t.Fatalf("OnServe trigger error = %v", err)
	}
}
