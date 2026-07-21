package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// seedOrgInviteWithID creates an org_invites row with a known ID and token
// hash so URLs can be constructed statically.
func seedOrgInviteWithID(t testing.TB, app *tests.TestApp, id, orgID, email, role, token string, expiresAt time.Time, consumed bool) *core.Record {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("org_invites")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(org_invites) error = %v", err)
	}

	hash := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(hash[:])

	record := core.NewRecord(collection)
	if id != "" {
		record.Id = id
	}
	record.Set("organisation", orgID)
	if email != "" {
		record.Set("invited_email", email)
	}
	record.Set("role", role)
	record.Set("token_hash", tokenHash)
	record.Set("expires_at", expiresAt)
	if consumed {
		record.Set("consumed_at", time.Now().UTC())
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(orgInviteRecord) error = %v", err)
	}
	return record
}

// seedOrgOwnedProject creates a project that belongs to an organisation.
func seedOrgOwnedProject(t testing.TB, app *tests.TestApp, projectID, orgID, ownerEmail string) {
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
	record.Set("organisation", orgID)
	record.Set("data", base64.StdEncoding.EncodeToString([]byte(`{"version":"1","name":"Seeded"}`)))
	record.Set("key_version", 1)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(projectRecord) error = %v", err)
	}

	seedProjectParticipant(t, app, projectID, userRecord.Id, "Admin")
}

// ---------------------------------------------------------------------------
// Collection rules
// ---------------------------------------------------------------------------

func TestOrgInvitesCollectionRulesAreLocked(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	collection, err := app.FindCollectionByNameOrId("org_invites")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(org_invites) error = %v", err)
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
			t.Errorf("org_invites.%s rule = %q, want nil (locked)", op, *rule)
		}
	}
}

func TestOrgInvitesCollectionRoutesLocked(t *testing.T) {
	t.Parallel()

	scenarios := []tests.ApiScenario{
		{
			Name:            "list org_invites as guest is denied",
			Method:          http.MethodGet,
			URL:             "/api/collections/org_invites/records",
			ExpectedStatus:  http.StatusForbidden,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:            "list org_invites via user token is denied",
			Method:          http.MethodGet,
			URL:             "/api/collections/org_invites/records",
			ExpectedStatus:  http.StatusForbidden,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
		},
		{
			Name:            "create org_invites via user token is denied",
			Method:          http.MethodPost,
			URL:             "/api/collections/org_invites/records",
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

// ---------------------------------------------------------------------------
// Create invite
// ---------------------------------------------------------------------------

func TestOrgInvitesCreateRoleGates(t *testing.T) {
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
			name:  "owner can create invite",
			orgID: "orginvite000001",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000001", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test1@example.com",
			wantStatus: http.StatusCreated,
			wantBody:   `"id"`,
		},
		{
			name:  "admin can create invite",
			orgID: "orginvite000002",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000002", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orginvite000002", "test2@example.com", "admin", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusCreated,
			wantBody:   `"id"`,
		},
		{
			name:  "member cannot create invite",
			orgID: "orginvite000003",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000003", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orginvite000003", "test2@example.com", "member", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
			wantBody:   `"message"`,
		},
		{
			name:  "non-member cannot create invite",
			orgID: "orginvite000004",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000004", "Acme GmbH", "test1@example.com")
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
				Method:          http.MethodPost,
				URL:             "/api/v1/orgs/" + c.orgID + "/invites",
				Body:            strings.NewReader(`{"email":"invited@example.com","role":"member"}`),
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

func TestOrgInvitesCreateReplacesPending(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "re-invite replaces existing pending invite",
		Method:          http.MethodPost,
		URL:             "/api/v1/orgs/orginvite000005/invites",
		Body:            strings.NewReader(`{"email":"test2@example.com","role":"admin"}`),
		ExpectedStatus:  http.StatusCreated,
		ExpectedContent: []string{"token"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000005", "Acme GmbH", "test1@example.com")
			seedOrgInviteWithID(t, app, "orginvitrepl001", "orginvite000005", "test2@example.com", "member", "token-first", time.Now().UTC().Add(24*time.Hour), false)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, err := app.FindRecordsByFilter("org_invites",
				"organisation = {:org} && invited_email = {:email} && consumed_at = ''",
				"", 0, 0,
				dbx.Params{"org": "orginvite000005", "email": "test2@example.com"})
			if err != nil {
				t.Fatalf("FindRecordsByFilter error = %v", err)
			}
			if len(records) != 1 {
				t.Fatalf("pending invite count = %d, want 1", len(records))
			}
			if records[0].GetString("role") != "admin" {
				t.Fatalf("pending invite role = %q, want admin", records[0].GetString("role"))
			}
		},
	}

	scenario.Test(t)
}

func TestOrgInvitesCreateTokenShownOnceAndHashed(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "token is returned once and stored as sha-256 hash",
		Method:          http.MethodPost,
		URL:             "/api/v1/orgs/orginvite000006/invites",
		Body:            strings.NewReader(`{"email":"test2@example.com","role":"member"}`),
		ExpectedStatus:  http.StatusCreated,
		ExpectedContent: []string{"token"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000006", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll error = %v", err)
			}

			var response struct {
				ID           string `json:"id"`
				Token        string `json:"token"`
				InvitedEmail string `json:"invited_email"`
				Role         string `json:"role"`
				ExpiresAt    string `json:"expires_at"`
			}
			if err := json.Unmarshal(body, &response); err != nil {
				t.Fatalf("json.Unmarshal error = %v", err)
			}

			if response.Token == "" {
				t.Fatal("response token is empty")
			}

			record, err := app.FindRecordById("org_invites", response.ID)
			if err != nil {
				t.Fatalf("FindRecordById error = %v", err)
			}

			storedHash := record.GetString("token_hash")
			if storedHash == response.Token {
				t.Fatal("stored token_hash equals raw token, expected hash")
			}

			hash := sha256.Sum256([]byte(response.Token))
			expectedHash := hex.EncodeToString(hash[:])
			if storedHash != expectedHash {
				t.Fatalf("stored token_hash = %q, want sha256 hex = %q", storedHash, expectedHash)
			}
		},
	}

	scenario.Test(t)
}

func TestOrgInvitesCreateStoresProjectIDs(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "create stores optional project_ids",
		Method:          http.MethodPost,
		URL:             "/api/v1/orgs/orginvite000007/invites",
		Body:            strings.NewReader(`{"email":"test2@example.com","role":"member","project_ids":["proj1","proj2"]}`),
		ExpectedStatus:  http.StatusCreated,
		ExpectedContent: []string{"token"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000007", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll error = %v", err)
			}

			var response struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(body, &response); err != nil {
				t.Fatalf("json.Unmarshal error = %v", err)
			}

			record, err := app.FindRecordById("org_invites", response.ID)
			if err != nil {
				t.Fatalf("FindRecordById error = %v", err)
			}

			raw := record.GetString("project_ids")
			if !strings.Contains(raw, `"proj1"`) || !strings.Contains(raw, `"proj2"`) {
				t.Fatalf("project_ids = %q, want both proj1 and proj2", raw)
			}
		},
	}

	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// List invites
// ---------------------------------------------------------------------------

func TestOrgInvitesListRoleGates(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		orgID      string
		seed       func(t testing.TB, app *tests.TestApp, e *core.ServeEvent)
		authEmail  string
		wantStatus int
	}{
		{
			name:  "owner can list invites",
			orgID: "orginvite000008",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000008", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test1@example.com",
			wantStatus: http.StatusOK,
		},
		{
			name:  "admin can list invites",
			orgID: "orginvite000009",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000009", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orginvite000009", "test2@example.com", "admin", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusOK,
		},
		{
			name:  "member cannot list invites",
			orgID: "orginvite000010",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000010", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orginvite000010", "test2@example.com", "member", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
		},
		{
			name:  "non-member cannot list invites",
			orgID: "orginvite000011",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000011", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusNotFound,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			s := tests.ApiScenario{
				Name:           c.name,
				Method:         http.MethodGet,
				URL:            "/api/v1/orgs/" + c.orgID + "/invites",
				ExpectedStatus: c.wantStatus,
				ExpectedContent: func() []string {
					switch c.wantStatus {
					case http.StatusOK:
						return []string{"["}
					case http.StatusNoContent:
						return nil // 204: empty body expected
					}
					return []string{"message"}
				}(),
				TestAppFactory: setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					c.seed(t, app, e)
					withRecordAuth("users", c.authEmail)(t, app, e)
				},
			}
			s.Test(t)
		})
	}
}

func TestOrgInvitesListOmitsTokenHash(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "list omits token_hash from response",
		Method:          http.MethodGet,
		URL:             "/api/v1/orgs/orginvite000012/invites",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"role"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000012", "Acme GmbH", "test1@example.com")
			seedOrgInviteWithID(t, app, "orginvitlist001", "orginvite000012", "test2@example.com", "member", "secret-token", time.Now().UTC().Add(24*time.Hour), false)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll error = %v", err)
			}
			bodyStr := string(body)
			if strings.Contains(bodyStr, "token_hash") {
				t.Fatalf("response contains token_hash: %s", bodyStr)
			}
			if strings.Contains(bodyStr, "secret-token") {
				t.Fatalf("response contains raw token: %s", bodyStr)
			}
		},
	}

	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// Revoke invite
// ---------------------------------------------------------------------------

func TestOrgInvitesRevokeRoleGates(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		orgID      string
		seed       func(t testing.TB, app *tests.TestApp, e *core.ServeEvent)
		authEmail  string
		wantStatus int
	}{
		{
			name:  "owner can revoke invite",
			orgID: "orginvite000013",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000013", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test1@example.com",
			wantStatus: http.StatusNoContent,
		},
		{
			name:  "admin can revoke invite",
			orgID: "orginvite000014",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000014", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orginvite000014", "test2@example.com", "admin", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusNoContent,
		},
		{
			name:  "member cannot revoke invite",
			orgID: "orginvite000015",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000015", "Acme GmbH", "test1@example.com")
				seedOrgMembership(t, app, "orginvite000015", "test2@example.com", "member", false)
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusForbidden,
		},
		{
			name:  "non-member cannot revoke invite",
			orgID: "orginvite000016",
			seed: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seedOrganisation(t, app, "orginvite000016", "Acme GmbH", "test1@example.com")
			},
			authEmail:  "test2@example.com",
			wantStatus: http.StatusNotFound,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()

			inviteID := "orginvitrovk" + c.orgID[len(c.orgID)-3:]
			s := tests.ApiScenario{
				Name:           c.name,
				Method:         http.MethodDelete,
				URL:            "/api/v1/orgs/" + c.orgID + "/invites/" + inviteID,
				ExpectedStatus: c.wantStatus,
				ExpectedContent: func() []string {
					switch c.wantStatus {
					case http.StatusOK:
						return []string{"["}
					case http.StatusNoContent:
						return nil // 204: empty body expected
					}
					return []string{"message"}
				}(),
				TestAppFactory: setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					c.seed(t, app, e)
					seedOrgInviteWithID(t, app, inviteID, c.orgID, "invited@example.com", "member", "revoke-token", time.Now().UTC().Add(24*time.Hour), false)
					withRecordAuth("users", c.authEmail)(t, app, e)
				},
			}
			s.Test(t)
		})
	}
}

// ---------------------------------------------------------------------------
// Accept invite
// ---------------------------------------------------------------------------

func TestOrgInvitesAcceptHappyPath(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "accept creates active membership",
		Method:          http.MethodPost,
		URL:             "/api/v1/org-invites/accept",
		Body:            strings.NewReader(`{"token":"accept-token-happy"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"organisation"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000017", "Acme GmbH", "test1@example.com")
			seedOrgInviteWithID(t, app, "orginvitacpt001", "orginvite000017", "test2@example.com", "member", "accept-token-happy", time.Now().UTC().Add(24*time.Hour), false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll error = %v", err)
			}

			var response struct {
				Organisation string `json:"organisation"`
				Role         string `json:"role"`
			}
			if err := json.Unmarshal(body, &response); err != nil {
				t.Fatalf("json.Unmarshal error = %v", err)
			}

			if response.Organisation != "orginvite000017" {
				t.Fatalf("organisation = %q, want orginvite000017", response.Organisation)
			}
			if response.Role != "member" {
				t.Fatalf("role = %q, want member", response.Role)
			}

			// Invite should be consumed
			invite, err := app.FindRecordById("org_invites", "orginvitacpt001")
			if err != nil {
				t.Fatalf("FindRecordById error = %v", err)
			}
			if invite.GetDateTime("consumed_at").IsZero() {
				t.Fatal("invite consumed_at is zero, expected set")
			}

			// Membership should be active
			membership, err := app.FindFirstRecordByFilter(
				"org_memberships",
				"organisation = {:org} && user = {:user} && removed_at = ''",
				dbx.Params{"org": "orginvite000017", "user": "xq9ndvc2kbrvrng"},
			)
			if err != nil {
				t.Fatalf("FindFirstRecordByFilter error = %v", err)
			}
			if membership.GetString("role") != "member" {
				t.Fatalf("membership role = %q, want member", membership.GetString("role"))
			}
		},
	}

	scenario.Test(t)
}

func TestOrgInvitesAcceptUpdatesPaddleSeatQuantity(t *testing.T) {
	fake := &fakeOrgPaddleClient{}

	scenario := tests.ApiScenario{
		Name:            "accept immediately adds the billed Paddle seat",
		Method:          http.MethodPost,
		URL:             "/api/v1/org-invites/accept",
		Body:            strings.NewReader(`{"token":"accept-token-seat"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"organisation"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithOrgBilling(t, fake)
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000024", "Acme GmbH", "test1@example.com")
			seedOrgBillingFields(t, app, "orginvite000024", map[string]any{
				"paddle_subscription_id": "sub_org_seats",
				"paddle_price_id":        "pri_org_seats",
				"seat_quantity":          1,
				"pending_seat_quantity":  1,
			})
			seedOrgInviteWithID(t, app, "orginvitacpt008", "orginvite000024", "test2@example.com", "member", "accept-token-seat", time.Now().UTC().Add(24*time.Hour), false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if fake.seatSubscriptionID != "sub_org_seats" {
				t.Errorf("subscription id = %q, want sub_org_seats", fake.seatSubscriptionID)
			}
			if fake.seatPriceID != "pri_org_seats" {
				t.Errorf("price id = %q, want pri_org_seats", fake.seatPriceID)
			}
			if fake.seatQuantity != 3 {
				t.Errorf("quantity = %d, want 3 (minimum seats when adding second member)", fake.seatQuantity)
			}
			if fake.seatMode != "prorated_immediately" {
				t.Errorf("mode = %q, want prorated_immediately", fake.seatMode)
			}
		},
	}

	scenario.Test(t)
}

func TestOrgInvitesAcceptSerialisesConcurrentSeatUpdates(t *testing.T) {
	fake := &fakeOrgPaddleClient{
		seatCallStarted: make(chan struct{}, 2),
		seatCallRelease: make(chan struct{}, 2),
	}
	app := setupTestAppWithOrgBilling(t, fake)
	seedOrganisation(t, app, "orginvite000026", "Acme GmbH", "test1@example.com")
	seedOrgMembership(t, app, "orginvite000026", "test2@example.com", "member", false)
	seedOrgBillingFields(t, app, "orginvite000026", map[string]any{
		"paddle_subscription_id": "sub_org_concurrent",
		"paddle_price_id":        "pri_org_seats",
		"seat_quantity":          3,
	})
	seedOrgInviteWithID(t, app, "orginvitacpt010", "orginvite000026", "no_data@example.com", "member", "accept-token-concurrent-a", time.Now().UTC().Add(24*time.Hour), false)
	seedOrgInviteWithID(t, app, "orginvitacpt011", "orginvite000026", "unverified@example.com", "member", "accept-token-concurrent-b", time.Now().UTC().Add(24*time.Hour), false)

	baseRouter, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("apis.NewRouter() error = %v", err)
	}
	var mux http.Handler
	serveEvent := &core.ServeEvent{App: app, Router: baseRouter}
	if err := app.OnServe().Trigger(serveEvent, func(e *core.ServeEvent) error {
		mux, err = e.Router.BuildMux()
		return err
	}); err != nil {
		t.Fatalf("OnServe.Trigger() error = %v", err)
	}

	tokenFor := func(email string) string {
		t.Helper()
		account, err := app.FindAuthRecordByEmail("users", email)
		if err != nil {
			t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", email, err)
		}
		token, err := account.NewAuthToken()
		if err != nil {
			t.Fatalf("NewAuthToken(%q) error = %v", email, err)
		}
		return token
	}

	accept := func(token, authToken string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/org-invites/accept", strings.NewReader(`{"token":"`+token+`"}`))
		req.Header.Set("content-type", "application/json")
		req.Header.Set("Authorization", authToken)
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, req)
		return recorder.Code
	}

	statuses := make(chan int, 2)
	firstAuthToken := tokenFor("no_data@example.com")
	secondAuthToken := tokenFor("unverified@example.com")
	var requests sync.WaitGroup
	requests.Add(2)
	go func() {
		defer requests.Done()
		statuses <- accept("accept-token-concurrent-a", firstAuthToken)
	}()
	<-fake.seatCallStarted
	go func() {
		defer requests.Done()
		statuses <- accept("accept-token-concurrent-b", secondAuthToken)
	}()

	select {
	case <-fake.seatCallStarted:
		// Both Paddle calls raced before either membership landed.
		fake.seatCallRelease <- struct{}{}
		fake.seatCallRelease <- struct{}{}
	case <-time.After(250 * time.Millisecond):
		// The second request is correctly waiting on the per-Organisation lock.
		fake.seatCallRelease <- struct{}{}
		<-fake.seatCallStarted
		fake.seatCallRelease <- struct{}{}
	}
	requests.Wait()
	close(statuses)
	for status := range statuses {
		if status != http.StatusOK {
			t.Errorf("OrgInvitesAccept(concurrent) status = %d, want %d", status, http.StatusOK)
		}
	}

	fake.mu.Lock()
	quantities := append([]int(nil), fake.seatQuantities...)
	fake.mu.Unlock()
	sort.Ints(quantities)
	if len(quantities) != 2 || quantities[0] != 3 || quantities[1] != 4 {
		t.Errorf("UpdateSubscriptionQuantity(concurrent) quantities = %v, want [3 4]", quantities)
	}
}

func TestOrgInvitesAcceptDoesNotCreateSeatWhenPaddleFails(t *testing.T) {
	fake := &fakeOrgPaddleClient{seatError: errors.New("paddle unavailable")}

	scenario := tests.ApiScenario{
		Name:            "Paddle failure leaves invite and membership unchanged",
		Method:          http.MethodPost,
		URL:             "/api/v1/org-invites/accept",
		Body:            strings.NewReader(`{"token":"accept-token-seat-fail"}`),
		ExpectedStatus:  http.StatusBadGateway,
		ExpectedContent: []string{"Could not add the Organisation Seat"},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithOrgBilling(t, fake)
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000025", "Acme GmbH", "test1@example.com")
			seedOrgBillingFields(t, app, "orginvite000025", map[string]any{
				"paddle_subscription_id": "sub_org_seats_fail",
				"paddle_price_id":        "pri_org_seats",
				"seat_quantity":          1,
				"pending_seat_quantity":  1,
			})
			seedOrgInviteWithID(t, app, "orginvitacpt009", "orginvite000025", "test2@example.com", "member", "accept-token-seat-fail", time.Now().UTC().Add(24*time.Hour), false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindFirstRecordByFilter(
				"org_memberships",
				"organisation = {:org} && user = {:user} && removed_at = ''",
				dbx.Params{"org": "orginvite000025", "user": "xq9ndvc2kbrvrng"},
			); err == nil {
				t.Fatal("membership was created despite Paddle failure")
			}
			invite, err := app.FindRecordById("org_invites", "orginvitacpt009")
			if err != nil {
				t.Fatalf("FindRecordById invite: %v", err)
			}
			if !invite.GetDateTime("consumed_at").IsZero() {
				t.Fatal("invite was consumed despite Paddle failure")
			}
		},
	}

	scenario.Test(t)
}

func TestOrgInvitesAcceptReactivatesAfterOffboard(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "accept reactivates existing membership after offboard",
		Method:          http.MethodPost,
		URL:             "/api/v1/org-invites/accept",
		Body:            strings.NewReader(`{"token":"accept-token-react"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"organisation"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000018", "Acme GmbH", "test1@example.com")
			// test2 was a member, then offboarded
			seedOrgMembership(t, app, "orginvite000018", "test2@example.com", "member", true)
			// New invite for test2
			seedOrgInviteWithID(t, app, "orginvitacpt002", "orginvite000018", "test2@example.com", "admin", "accept-token-react", time.Now().UTC().Add(24*time.Hour), false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll error = %v", err)
			}

			var response struct {
				Organisation string `json:"organisation"`
				Role         string `json:"role"`
			}
			if err := json.Unmarshal(body, &response); err != nil {
				t.Fatalf("json.Unmarshal error = %v", err)
			}

			// Reactivation preserves the original role from the membership row,
			// not the invite role — the unique index forces reactivation.
			if response.Role != "member" {
				t.Fatalf("role = %q, want member (original row preserved)", response.Role)
			}

			membership, err := app.FindFirstRecordByFilter(
				"org_memberships",
				"organisation = {:org} && user = {:user}",
				dbx.Params{"org": "orginvite000018", "user": "xq9ndvc2kbrvrng"},
			)
			if err != nil {
				t.Fatalf("FindFirstRecordByFilter error = %v", err)
			}
			if !membership.GetDateTime("removed_at").IsZero() {
				t.Fatal("membership removed_at is set, expected cleared")
			}
		},
	}

	scenario.Test(t)
}

func TestOrgInvitesAcceptNeutral404s(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name  string
		token string
		seed  func(t testing.TB, app *tests.TestApp)
	}{
		{
			name:  "unknown token",
			token: "totally-unknown-token",
			seed:  func(t testing.TB, app *tests.TestApp) {},
		},
		{
			name:  "consumed token",
			token: "consumed-token-001",
			seed: func(t testing.TB, app *tests.TestApp) {
				seedOrganisation(t, app, "orginvite000019", "Acme GmbH", "test1@example.com")
				seedOrgInviteWithID(t, app, "orginvitacpt003", "orginvite000019", "test2@example.com", "member", "consumed-token-001", time.Now().UTC().Add(24*time.Hour), true)
			},
		},
		{
			name:  "expired token",
			token: "expired-token-0001",
			seed: func(t testing.TB, app *tests.TestApp) {
				seedOrganisation(t, app, "orginvite000019", "Acme GmbH", "test1@example.com")
				seedOrgInviteWithID(t, app, "orginvitacpt004", "orginvite000019", "test2@example.com", "member", "expired-token-0001", time.Now().UTC().Add(-24*time.Hour), false)
			},
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			s := tests.ApiScenario{
				Name:            c.name,
				Method:          http.MethodPost,
				URL:             "/api/v1/org-invites/accept",
				Body:            strings.NewReader(`{"token":"` + c.token + `"}`),
				ExpectedStatus:  http.StatusNotFound,
				ExpectedContent: []string{`"message"`},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					c.seed(t, app)
					withRecordAuth("users", "test2@example.com")(t, app, e)
				},
			}
			s.Test(t)
		})
	}
}

func TestOrgInvitesAcceptIdempotentForActiveMember(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "accept is idempotent for already-active member",
		Method:          http.MethodPost,
		URL:             "/api/v1/org-invites/accept",
		Body:            strings.NewReader(`{"token":"accept-token-idem"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"organisation"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000020", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orginvite000020", "test2@example.com", "admin", false)
			seedOrgInviteWithID(t, app, "orginvitacpt005", "orginvite000020", "test2@example.com", "member", "accept-token-idem", time.Now().UTC().Add(24*time.Hour), false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll error = %v", err)
			}

			var response struct {
				Organisation string `json:"organisation"`
				Role         string `json:"role"`
			}
			if err := json.Unmarshal(body, &response); err != nil {
				t.Fatalf("json.Unmarshal error = %v", err)
			}

			if response.Role != "admin" {
				t.Fatalf("role = %q, want admin (existing membership preserved)", response.Role)
			}

			// Invite must stay unconsumed — idempotent accept does not consume.
			invite, err := app.FindRecordById("org_invites", "orginvitacpt005")
			if err != nil {
				t.Fatalf("FindRecordById error = %v", err)
			}
			if !invite.GetDateTime("consumed_at").IsZero() {
				t.Fatal("invite consumed_at was set on idempotent accept")
			}
		},
	}

	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// Offboard member
// ---------------------------------------------------------------------------

func TestOrgMembersOffboardSelfAsOwner(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "owner cannot offboard themselves",
		Method:          http.MethodDelete,
		URL:             "/api/v1/orgs/orginvite000021/members/uvi8zmr78j9y5hz",
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{`"message"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000021", "Acme GmbH", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrgMembersOffboardOwnerAsAdmin(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "admin cannot offboard the org owner",
		Method:          http.MethodDelete,
		URL:             "/api/v1/orgs/orginvite000022/members/uvi8zmr78j9y5hz",
		ExpectedStatus:  http.StatusForbidden,
		ExpectedContent: []string{`"message"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000022", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orginvite000022", "test2@example.com", "admin", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrgMembersOffboardHappyPath(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "offboard revokes membership and project access",
		Method:          http.MethodDelete,
		URL:             "/api/v1/orgs/orginvite000023/members/xq9ndvc2kbrvrng",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"rotation_project_ids":["orgproj00000001"]`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000023", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orginvite000023", "test2@example.com", "member", false)
			seedOrgOwnedProject(t, app, "orgproj00000001", "orginvite000023", "test1@example.com")
			seedProjectParticipant(t, app, "orgproj00000001", "xq9ndvc2kbrvrng", "Editor")
			seedOrgBillingFields(t, app, "orginvite000023", map[string]any{
				"seat_quantity":         2,
				"pending_seat_quantity": 2,
			})
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			// Membership soft-revoked
			membership, err := app.FindFirstRecordByFilter(
				"org_memberships",
				"organisation = {:org} && user = {:user}",
				dbx.Params{"org": "orginvite000023", "user": "xq9ndvc2kbrvrng"},
			)
			if err != nil {
				t.Fatalf("FindFirstRecordByFilter(org_memberships) error = %v", err)
			}
			if membership.GetDateTime("removed_at").IsZero() {
				t.Fatal("membership removed_at is zero, expected set")
			}

			// Project participant soft-revoked
			participant, err := app.FindFirstRecordByFilter(
				"project_participants",
				"project = {:project} && user = {:user}",
				dbx.Params{"project": "orgproj00000001", "user": "xq9ndvc2kbrvrng"},
			)
			if err != nil {
				t.Fatalf("FindFirstRecordByFilter(project_participants) error = %v", err)
			}
			if participant.GetDateTime("removed_at").IsZero() {
				t.Fatal("project participant removed_at is zero, expected set")
			}
			project, err := app.FindRecordById("projects", "orgproj00000001")
			if err != nil {
				t.Fatalf("FindRecordById(projects) error = %v", err)
			}
			if !project.GetBool("rotation_pending") {
				t.Fatal("projects.rotation_pending = false, want true after offboard")
			}

			// pending_seat_quantity reflects the minimum billed seats next cycle
			billing, err := app.FindFirstRecordByFilter(
				"org_billing",
				"organisation = {:org}",
				dbx.Params{"org": "orginvite000023"},
			)
			if err != nil {
				t.Fatalf("FindFirstRecordByFilter(org_billing) error = %v", err)
			}
			if billing.GetInt("pending_seat_quantity") != 3 {
				t.Fatalf("pending_seat_quantity = %d, want 3 (one member remains, minimum 3 seats)", billing.GetInt("pending_seat_quantity"))
			}

			// User personal record untouched
			if _, err := app.FindAuthRecordByEmail("users", "test2@example.com"); err != nil {
				t.Fatalf("user record was touched: %v", err)
			}
		},
	}

	scenario.Test(t)
}

func TestOrgMembersOffboardRejectsLastProjectAdmin(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "offboard refuses to strand a Project without an Admin",
		Method:          http.MethodDelete,
		URL:             "/api/v1/orgs/orginvite000026/members/xq9ndvc2kbrvrng",
		ExpectedStatus:  http.StatusConflict,
		ExpectedContent: []string{`"message":"Assign another Project Admin before offboarding this member."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000026", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orginvite000026", "test2@example.com", "member", false)
			seedOrgOwnedProject(t, app, "orgproj00000002", "orginvite000026", "test2@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			membership, err := app.FindFirstRecordByFilter(
				"org_memberships",
				"organisation = {:org} && user = {:user} && removed_at = ''",
				dbx.Params{"org": "orginvite000026", "user": "xq9ndvc2kbrvrng"},
			)
			if err != nil || membership == nil {
				t.Fatalf("active membership changed on rejected offboard: err=%v", err)
			}
			project, err := app.FindRecordById("projects", "orgproj00000002")
			if err != nil {
				t.Fatalf("FindRecordById(projects) error = %v", err)
			}
			if project.GetBool("rotation_pending") {
				t.Fatal("rotation_pending changed on rejected offboard")
			}
		},
	}

	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// Public key
// ---------------------------------------------------------------------------

func TestUserPublicKeySharedOrg(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "owner can resolve public key of org member",
		Method:          http.MethodGet,
		URL:             "/api/v1/users/xq9ndvc2kbrvrng/public-key",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"public_key"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, "orginvite000024", "Acme GmbH", "test1@example.com")
			seedOrgMembership(t, app, "orginvite000024", "test2@example.com", "member", false)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll error = %v", err)
			}
			if !strings.Contains(string(body), `"public_key"`) {
				t.Fatalf("response missing public_key: %s", string(body))
			}
			if !strings.Contains(string(body), "O0juXdZBDWNKqMQrShgh7wUyijMUwboM0a7hJyQvXhU=") {
				t.Fatalf("response missing test2 public key: %s", string(body))
			}
		},
	}

	scenario.Test(t)
}

func TestUserPublicKeyCallerIsTarget(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "caller can resolve their own public key",
		Method:          http.MethodGet,
		URL:             "/api/v1/users/uvi8zmr78j9y5hz/public-key",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"public_key"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll error = %v", err)
			}
			if !strings.Contains(string(body), "FaTq77hDYWu9pNLMwBlQ4Ks54BAfwz1Y7/nmyZTLkTE=") {
				t.Fatalf("response missing test1 public key: %s", string(body))
			}
		},
	}

	scenario.Test(t)
}

func TestUserPublicKeyUnrelatedCaller(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "unrelated caller cannot resolve public key",
		Method:          http.MethodGet,
		URL:             "/api/v1/users/xq9ndvc2kbrvrng/public-key",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc:  withRecordAuth("users", "no_data@example.com"),
	}

	scenario.Test(t)
}
