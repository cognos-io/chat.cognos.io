package main

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestOrganisationDissolveDeletesConfirmedProjectsAndRevokesMemberships(t *testing.T) {
	client := &fakeOrgPaddleClient{}
	const (
		orgID             = "orgdissolve0001"
		projectID         = "orgdissproj0001"
		personalProjectID = "personalproj001"
	)

	scenario := tests.ApiScenario{
		Name:           "owner confirms Organisation Project deletion",
		Method:         http.MethodDelete,
		URL:            "/api/v1/orgs/" + orgID,
		Body:           strings.NewReader(`{"delete_projects":true}`),
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithOrgBilling(t, client)
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			seedOwnedProject(t, app, personalProjectID, "test1@example.com")
			seedOrgBillingFields(t, app, orgID, map[string]any{
				"paddle_subscription_id": "sub_org_dissolve",
			})
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			org, err := app.FindRecordById("organisations", orgID)
			if err != nil {
				t.Fatalf("FindRecordById(organisations, %q) error = %v", orgID, err)
			}
			if org.GetDateTime("dissolved_at").IsZero() {
				t.Errorf("organisations[%q].dissolved_at is zero, want dissolution timestamp", orgID)
			}

			memberships, err := app.FindRecordsByFilter(
				"org_memberships", "organisation = {:org}", "", 0, 0, dbx.Params{"org": orgID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(org_memberships, %q) error = %v", orgID, err)
			}
			if len(memberships) != 2 {
				t.Fatalf("len(org_memberships for %q) = %d, want 2 retained rows", orgID, len(memberships))
			}
			for _, membership := range memberships {
				if membership.GetDateTime("removed_at").IsZero() {
					t.Errorf("org_memberships[%q].removed_at is zero, want soft revoke", membership.Id)
				}
			}

			if _, err := app.FindRecordById("projects", projectID); err == nil {
				t.Errorf("FindRecordById(projects, %q) error = nil, want confirmed Project deleted", projectID)
			}
			if _, err := app.FindRecordById("projects", personalProjectID); err != nil {
				t.Errorf("FindRecordById(projects, %q) error = %v, want personal Project untouched", personalProjectID, err)
			}
			participants, err := app.FindRecordsByFilter(
				"project_participants", "project = {:project}", "", 0, 0, dbx.Params{"project": projectID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(project_participants, %q) error = %v", projectID, err)
			}
			if len(participants) != 0 {
				t.Errorf("len(project_participants for deleted Project %q) = %d, want 0", projectID, len(participants))
			}
			if _, err := app.FindFirstRecordByData("org_billing", "organisation", orgID); err != nil {
				t.Errorf("FindFirstRecordByData(org_billing, %q) error = %v, want retained ledger state", orgID, err)
			}
			event := requireAuditEvent(t, app, orgID, "org.dissolved")
			if got := event.GetString("target"); got != orgID {
				t.Errorf("org.dissolved audit target = %q, want %q", got, orgID)
			}

			client.mu.Lock()
			cancelled := client.cancelledSubscriptionID
			client.mu.Unlock()
			if cancelled != "sub_org_dissolve" {
				t.Errorf("CancelSubscription() subscription = %q, want %q", cancelled, "sub_org_dissolve")
			}
		},
	}

	scenario.Test(t)
}

func TestOrganisationDissolveRequiresProjectDeletionConfirmation(t *testing.T) {
	client := &fakeOrgPaddleClient{}
	const (
		orgID     = "orgdissolve0002"
		projectID = "orgdissproj0002"
	)

	scenario := tests.ApiScenario{
		Name:            "Organisation Projects cannot silently become personal",
		Method:          http.MethodDelete,
		URL:             "/api/v1/orgs/" + orgID,
		ExpectedStatus:  http.StatusConflict,
		ExpectedContent: []string{`"message":"Confirm deletion of every Organisation Project before dissolving."`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithOrgBilling(t, client)
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Acme GmbH", "test1@example.com")
			seedOrgOwnedProject(t, app, projectID, orgID, "test1@example.com")
			seedOrgBillingFields(t, app, orgID, map[string]any{
				"paddle_subscription_id": "sub_must_not_cancel",
			})
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			org, err := app.FindRecordById("organisations", orgID)
			if err != nil {
				t.Fatalf("FindRecordById(organisations, %q) error = %v", orgID, err)
			}
			if !org.GetDateTime("dissolved_at").IsZero() {
				t.Errorf("organisations[%q].dissolved_at is non-zero, want unchanged", orgID)
			}
			if _, err := app.FindRecordById("projects", projectID); err != nil {
				t.Errorf("FindRecordById(projects, %q) error = %v, want Project retained", projectID, err)
			}
			client.mu.Lock()
			cancelled := client.cancelledSubscriptionID
			client.mu.Unlock()
			if cancelled != "" {
				t.Errorf("CancelSubscription() subscription = %q, want no call", cancelled)
			}
		},
	}

	scenario.Test(t)
}

func TestOrganisationDissolveIsOwnerOnly(t *testing.T) {
	testCases := []struct {
		name       string
		email      string
		role       string
		wantStatus int
		wantBody   string
	}{
		{name: "admin", email: "test2@example.com", role: "admin", wantStatus: http.StatusForbidden, wantBody: `"message":"Only the organisation owner can dissolve the organisation."`},
		{name: "member", email: "test2@example.com", role: "member", wantStatus: http.StatusForbidden, wantBody: `"message":"Only the organisation owner can dissolve the organisation."`},
		{name: "non-member", email: "test2@example.com", wantStatus: http.StatusNotFound, wantBody: `"message":"Organisation not found."`},
	}

	for i, tt := range testCases {
		t.Run(tt.name, func(t *testing.T) {
			orgID := []string{"orgdissolve0003", "orgdissolve0004", "orgdissolve0005"}[i]
			scenario := tests.ApiScenario{
				Name:            "only the Organisation Owner may dissolve",
				Method:          http.MethodDelete,
				URL:             "/api/v1/orgs/" + orgID,
				ExpectedStatus:  tt.wantStatus,
				ExpectedContent: []string{tt.wantBody},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					seedOrganisation(t, app, orgID, "Acme GmbH", "test1@example.com")
					if tt.role != "" {
						seedOrgMembership(t, app, orgID, tt.email, tt.role, false)
					}
					withRecordAuth("users", tt.email)(t, app, e)
				},
				AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
					org, err := app.FindRecordById("organisations", orgID)
					if err != nil {
						t.Fatalf("FindRecordById(organisations, %q) error = %v", orgID, err)
					}
					if !org.GetDateTime("dissolved_at").IsZero() {
						t.Errorf("organisations[%q].dissolved_at is non-zero after denied request", orgID)
					}
				},
			}
			scenario.Test(t)
		})
	}
}

func TestOrganisationDissolvePaddleFailureLeavesOrganisationActive(t *testing.T) {
	client := &fakeOrgPaddleClient{cancelError: errors.New("paddle unavailable")}
	const orgID = "orgdissolve0006"

	scenario := tests.ApiScenario{
		Name:            "failed subscription cancellation does not dissolve locally",
		Method:          http.MethodDelete,
		URL:             "/api/v1/orgs/" + orgID,
		ExpectedStatus:  http.StatusBadGateway,
		ExpectedContent: []string{`"message":"Failed to cancel Organisation subscription."`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithOrgBilling(t, client)
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			seedOrgBillingFields(t, app, orgID, map[string]any{
				"paddle_subscription_id": "sub_cancel_fails",
			})
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			org, err := app.FindRecordById("organisations", orgID)
			if err != nil {
				t.Fatalf("FindRecordById(organisations, %q) error = %v", orgID, err)
			}
			if !org.GetDateTime("dissolved_at").IsZero() {
				t.Errorf("organisations[%q].dissolved_at is non-zero, want unchanged", orgID)
			}
			members, err := app.FindRecordsByFilter(
				"org_memberships", "organisation = {:org} && removed_at = ''", "", 0, 0, dbx.Params{"org": orgID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(active org memberships) error = %v", err)
			}
			if len(members) != 2 {
				t.Errorf("len(active org memberships) = %d, want 2 after Paddle failure", len(members))
			}
		},
	}

	scenario.Test(t)
}

func TestOrganisationDissolveWithoutSubscription(t *testing.T) {
	client := &fakeOrgPaddleClient{}
	const orgID = "orgdissolve0007"

	scenario := tests.ApiScenario{
		Name:           "Organisation without checkout can dissolve",
		Method:         http.MethodDelete,
		URL:            "/api/v1/orgs/" + orgID,
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithOrgBilling(t, client)
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			org, err := app.FindRecordById("organisations", orgID)
			if err != nil {
				t.Fatalf("FindRecordById(organisations, %q) error = %v", orgID, err)
			}
			if org.GetDateTime("dissolved_at").Time().After(time.Now().UTC().Add(time.Second)) {
				t.Errorf("organisations[%q].dissolved_at is unexpectedly in the future", orgID)
			}
			client.mu.Lock()
			cancelled := client.cancelledSubscriptionID
			client.mu.Unlock()
			if cancelled != "" {
				t.Errorf("CancelSubscription() subscription = %q, want no call", cancelled)
			}
		},
	}

	scenario.Test(t)
}
