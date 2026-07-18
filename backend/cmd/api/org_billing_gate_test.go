package main

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// These tests pin the org billing gate (spec docs/specs/organisations.md
// §7.5/§7.6 and docs/business_processes/billing-access-gate.md): a
// conversation in an org-owned Project bills the Organisation — regardless of
// who types — and FAILS CLOSED when the org has no active billing. It must
// never silently fall back to the member's personal balance, and org usage
// must never deplete anyone's personal balance.

// seedOrgProject marks an already-seeded project as org-owned.
func seedOrgProject(t testing.TB, app *tests.TestApp, projectID, orgID string) {
	t.Helper()

	record, err := app.FindRecordById("projects", projectID)
	if err != nil {
		t.Fatalf("FindRecordById(projects, %q) error = %v", projectID, err)
	}
	record.Set("organisation", orgID)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(org project) error = %v", err)
	}
}

// seedOrgBilling creates the org_billing row. Tests that want the
// missing-row (never-checked-out) state simply do not call it.
func seedOrgBilling(t testing.TB, app *tests.TestApp, orgID, planType string, pastDue bool, seats int) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("org_billing")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(org_billing) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Set("organisation", orgID)
	record.Set("plan_type", planType)
	record.Set("past_due", pastDue)
	record.Set("seat_quantity", seats)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(org_billing) error = %v", err)
	}
}

// seedUserBillingBalance upserts the user's personal billing row with an
// explicit balance so tests can assert it stays untouched.
func seedUserBillingBalance(t testing.TB, app *tests.TestApp, email, planType string, balanceRappen int64) {
	t.Helper()

	userRecord, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", email, err)
	}

	collection, err := app.FindCollectionByNameOrId("user_billing")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(user_billing) error = %v", err)
	}

	record, err := app.FindFirstRecordByData("user_billing", "user_id", userRecord.Id)
	if err != nil {
		record = core.NewRecord(collection)
		record.Set("user_id", userRecord.Id)
	}
	record.Set("plan_type", planType)
	record.Set("balance_rappen", balanceRappen)
	record.Set("balance_microrappen", balanceRappen*billing.MicroRappenPerRappen)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(user_billing) error = %v", err)
	}
}

func personalBalanceMicroRappen(t testing.TB, app *tests.TestApp, email string) int64 {
	t.Helper()

	userRecord, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", email, err)
	}
	record, err := app.FindFirstRecordByData("user_billing", "user_id", userRecord.Id)
	if err != nil {
		t.Fatalf("FindFirstRecordByData(user_billing) error = %v", err)
	}
	return int64(record.GetInt("balance_microrappen"))
}

// seedOrgConversationFixture builds the whole chain for one test: an
// Organisation owned by ownerEmail, an org-owned Project, and a Project
// conversation. Distinct ids per test keep t.Parallel() safe.
func seedOrgConversationFixture(
	t testing.TB,
	app *tests.TestApp,
	orgID, orgName, projectID, conversationID, ownerEmail string,
) [32]byte {
	t.Helper()

	seedOrganisation(t, app, orgID, orgName, ownerEmail)
	seedOwnedProject(t, app, projectID, ownerEmail)
	seedOrgProject(t, app, projectID, orgID)
	return seedProjectConversation(t, app, projectID, conversationID, ownerEmail)
}

// Direct ciphertext routes share the same fail-closed gate as provider-backed
// completions. A healthy personal plan must never become a fallback payer for
// an org-owned Project whose billing is missing.
func TestOrgBillingGateBlocksDirectContentWrites(t *testing.T) {
	t.Parallel()

	encodedData := "eyJ0aXRsZSI6IkNoYW5nZWQifQ=="
	publicKey := "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MEE="
	cases := []struct {
		name           string
		method         string
		url            string
		body           string
		orgID          string
		projectID      string
		conversationID string
		planType       string
		pastDue        bool
		wantError      string
	}{
		{
			name:      "Project title edit",
			method:    http.MethodPatch,
			url:       "/api/v1/projects/orgwriteproj001",
			body:      `{"data":"` + encodedData + `"}`,
			orgID:     "orgwriteblock01",
			projectID: "orgwriteproj001",
			wantError: billing.OrgBillingInactiveError,
		},
		{
			name:      "Project Conversation create",
			method:    http.MethodPost,
			url:       "/api/v1/projects/orgwriteproj002/conversations",
			body:      `{"data":"` + encodedData + `","public_key":"` + publicKey + `","wrapped_conversation_secret_key":"d3JhcHBlZA=="}`,
			orgID:     "orgwriteblock02",
			projectID: "orgwriteproj002",
			wantError: billing.OrgBillingInactiveError,
		},
		{
			name:           "Project Conversation title edit",
			method:         http.MethodPatch,
			url:            "/api/v1/conversations/orgwriteconv003",
			body:           `{"data":"` + encodedData + `"}`,
			orgID:          "orgwriteblock03",
			projectID:      "orgwriteproj003",
			conversationID: "orgwriteconv003",
			wantError:      billing.OrgBillingInactiveError,
		},
		{
			name:      "Project memory create",
			method:    http.MethodPost,
			url:       "/api/v1/projects/orgwriteproj004/memory",
			body:      `{"data":"c2VhbGVkLW1lbW9yeQ=="}`,
			orgID:     "orgwriteblock04",
			projectID: "orgwriteproj004",
			wantError: billing.OrgBillingInactiveError,
		},
		{
			name:      "past-due Project title edit",
			method:    http.MethodPatch,
			url:       "/api/v1/projects/orgwriteproj005",
			body:      `{"data":"` + encodedData + `"}`,
			orgID:     "orgwriteblock05",
			projectID: "orgwriteproj005",
			planType:  "payg",
			pastDue:   true,
			wantError: billing.OrgBillingPastDueError,
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			scenario := tests.ApiScenario{
				Name:            tt.name + " fails closed",
				Method:          tt.method,
				URL:             tt.url,
				Body:            strings.NewReader(tt.body),
				ExpectedStatus:  http.StatusPaymentRequired,
				ExpectedContent: []string{`"error":"` + tt.wantError + `"`, `"organisation_id":"` + tt.orgID + `"`},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					seedOrganisation(t, app, tt.orgID, "Lapsed AG", "test1@example.com")
					seedOwnedProject(t, app, tt.projectID, "test1@example.com")
					seedOrgProject(t, app, tt.projectID, tt.orgID)
					if tt.planType != "" {
						seedOrgBilling(t, app, tt.orgID, tt.planType, tt.pastDue, 1)
					}
					if tt.conversationID != "" {
						seedProjectConversation(t, app, tt.projectID, tt.conversationID, "test1@example.com")
					}
					seedUserBillingBalance(t, app, "test1@example.com", "payg", 10_000)
					withRecordAuth("users", "test1@example.com")(t, app, e)
				},
			}
			scenario.Test(t)
		})
	}
}

func TestOrgBillingGateReactivationRestoresDirectWrites(t *testing.T) {
	t.Parallel()

	projectID := "orgwriteactive1"
	orgID := "orgwriteactive2"
	encodedData := "eyJ0aXRsZSI6IlJlc3RvcmVkIn0="
	scenario := tests.ApiScenario{
		Name:            "active org Project title edit is writable",
		Method:          http.MethodPatch,
		URL:             "/api/v1/projects/" + projectID,
		Body:            strings.NewReader(`{"data":"` + encodedData + `"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"data":"` + encodedData + `"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Restored AG", "test1@example.com")
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedOrgProject(t, app, projectID, orgID)
			seedOrgBilling(t, app, orgID, "payg", false, 1)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	scenario.Test(t)
}

func TestOrgBillingGateBlocksProjectCreateWithoutPersonalFallback(t *testing.T) {
	t.Parallel()

	orgID := "orgwritecreate1"
	encodedData := "eyJ0aXRsZSI6Ik5ldyBQcm9qZWN0In0="
	scenario := tests.ApiScenario{
		Name:            "Project create in inactive org fails closed",
		Method:          http.MethodPost,
		URL:             "/api/v1/projects",
		Body:            strings.NewReader(`{"data":"` + encodedData + `","wrapped_project_key":"d3JhcHBlZA==","organisation":"` + orgID + `"}`),
		ExpectedStatus:  http.StatusPaymentRequired,
		ExpectedContent: []string{`"error":"ORG_BILLING_INACTIVE"`, `"organisation_id":"` + orgID + `"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "No Billing AG", "test1@example.com")
			seedUserBillingBalance(t, app, "test1@example.com", "payg", 10_000)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	scenario.Test(t)
}

func TestOrgBillingGateLeavesPersonalProjectWritesUnaffected(t *testing.T) {
	t.Parallel()

	projectID := "personalwrite01"
	encodedData := "eyJ0aXRsZSI6IlBlcnNvbmFsIn0="
	scenario := tests.ApiScenario{
		Name:            "personal Project title edit remains writable",
		Method:          http.MethodPatch,
		URL:             "/api/v1/projects/" + projectID,
		Body:            strings.NewReader(`{"data":"` + encodedData + `"}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"data":"` + encodedData + `"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	scenario.Test(t)
}

// StateForContext resolution matrix: which subject pays, purely from the
// conversation → project → organisation chain.
func TestStateForContextResolutionMatrix(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)
	repo := billing.NewPocketBaseRepo(app)

	user, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail error = %v", err)
	}
	seedUserBillingBalance(t, app, "test1@example.com", "trial", 500)

	// Standalone conversation (no project).
	seedConversationRecord(t, app, "ctxstandalone01")

	// Personal project conversation.
	seedOwnedProject(t, app, "ctxpersonalproj", "test1@example.com")
	seedProjectConversation(t, app, "ctxpersonalproj", "ctxpersonalconv", "test1@example.com")

	// Org project conversation with healthy billing.
	seedOrgConversationFixture(t, app, "ctxorghealthy01", "Acme GmbH", "ctxorghealthpj1", "ctxorghealthcnv", "test1@example.com")
	seedOrgBilling(t, app, "ctxorghealthy01", "payg", false, 3)

	// Org project conversation with NO org_billing row (checkout never done).
	seedOrgConversationFixture(t, app, "ctxorgmissing01", "Missing AG", "ctxorgmissproj1", "ctxorgmisscnv01", "test1@example.com")

	// Org project conversation with a past-due subscription.
	seedOrgConversationFixture(t, app, "ctxorgpastdue01", "Dunning SA", "ctxorgdueproj01", "ctxorgduecnv001", "test1@example.com")
	seedOrgBilling(t, app, "ctxorgpastdue01", "payg", true, 2)

	// Org project conversation with a canceled (inactive) subscription.
	seedOrgConversationFixture(t, app, "ctxorginactive1", "Lapsed AG", "ctxorginactproj", "ctxorginactcnv1", "test1@example.com")
	seedOrgBilling(t, app, "ctxorginactive1", "inactive", false, 2)

	tests := []struct {
		name           string
		conversationID string
		wantSubject    billing.Subject
		wantPlan       billing.PlanType
		wantPastDue    bool
		wantOrgName    string
	}{
		{
			name:           "no conversation resolves personally",
			conversationID: "",
			wantSubject:    billing.UserSubject(user.Id),
			wantPlan:       billing.PlanTypeTrial,
		},
		{
			name:           "unknown conversation resolves personally (stateless semantics)",
			conversationID: "doesnotexist000",
			wantSubject:    billing.UserSubject(user.Id),
			wantPlan:       billing.PlanTypeTrial,
		},
		{
			name:           "standalone conversation resolves personally",
			conversationID: "ctxstandalone01",
			wantSubject:    billing.UserSubject(user.Id),
			wantPlan:       billing.PlanTypeTrial,
		},
		{
			name:           "personal project conversation resolves personally",
			conversationID: "ctxpersonalconv",
			wantSubject:    billing.UserSubject(user.Id),
			wantPlan:       billing.PlanTypeTrial,
		},
		{
			name:           "org project conversation resolves to the organisation",
			conversationID: "ctxorghealthcnv",
			wantSubject:    billing.OrgSubject("ctxorghealthy01"),
			wantPlan:       billing.PlanTypePayG,
			wantOrgName:    "Acme GmbH",
		},
		{
			name:           "org project without org_billing fails closed as inactive — never personal",
			conversationID: "ctxorgmisscnv01",
			wantSubject:    billing.OrgSubject("ctxorgmissing01"),
			wantPlan:       billing.PlanTypeInactive,
			wantOrgName:    "Missing AG",
		},
		{
			name:           "past-due org keeps payg plan with the past_due flag",
			conversationID: "ctxorgduecnv001",
			wantSubject:    billing.OrgSubject("ctxorgpastdue01"),
			wantPlan:       billing.PlanTypePayG,
			wantPastDue:    true,
			wantOrgName:    "Dunning SA",
		},
		{
			name:           "canceled org resolves inactive",
			conversationID: "ctxorginactcnv1",
			wantSubject:    billing.OrgSubject("ctxorginactive1"),
			wantPlan:       billing.PlanTypeInactive,
			wantOrgName:    "Lapsed AG",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolved, err := repo.StateForContext(user.Id, tt.conversationID)
			if err != nil {
				t.Fatalf("StateForContext() error = %v", err)
			}
			if resolved.Subject != tt.wantSubject {
				t.Errorf("Subject = %+v, want %+v", resolved.Subject, tt.wantSubject)
			}
			if resolved.State.PlanType != tt.wantPlan {
				t.Errorf("State.PlanType = %q, want %q", resolved.State.PlanType, tt.wantPlan)
			}
			if resolved.State.PastDue != tt.wantPastDue {
				t.Errorf("State.PastDue = %v, want %v", resolved.State.PastDue, tt.wantPastDue)
			}
			if resolved.OrganisationName != tt.wantOrgName {
				t.Errorf("OrganisationName = %q, want %q", resolved.OrganisationName, tt.wantOrgName)
			}
		})
	}
}

// The critical security/product test: a member with a perfectly healthy
// personal balance completes in an org Project whose Organisation has no
// billing. The request must 402 BEFORE any provider call AND the member's
// personal balance must stay untouched — no silent fallback, ever.
func TestOrgCompletionFailsClosedWithoutFallingBackToPersonalBalance(t *testing.T) {
	t.Parallel()

	conversationID := "orgfailclosedcv"
	var conversationPublicKey [32]byte
	const seedBalanceRappen = 500

	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			t.Fatal("Complete() must not be called when the org billing gate blocks")
			return gateway.CompleteResponse{}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "org project completion without org billing fails closed",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusPaymentRequired,
		ExpectedContent: []string{
			`"error":"ORG_BILLING_INACTIVE"`,
			`"organisation_id":"orgfailclosed01"`,
			`"organisation_name":"Acme GmbH"`,
			`"admin_message":"Reactivate the subscription for Acme GmbH to restore access."`,
			`"next_step":"org_subscribe"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			// BillingStateRepo and BillingLedgerRepo stay nil so the REAL
			// PocketBase repo resolves the context — that resolution is the
			// behaviour under test.
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
				ConversationRepo: stubConversationRepo{
					byID: func(id string) (chat.Conversation, error) {
						return chat.Conversation{ID: id, PublicKey: conversationPublicKey}, nil
					},
				},
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedUserBillingBalance(t, app, "test1@example.com", "trial", seedBalanceRappen)
			conversationPublicKey = seedOrgConversationFixture(
				t, app,
				"orgfailclosed01", "Acme GmbH", "orgfailclosedpj", conversationID,
				"test1@example.com",
			)
			// Deliberately NO seedOrgBilling: checkout never completed.
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if got := personalBalanceMicroRappen(t, app, "test1@example.com"); got != seedBalanceRappen*billing.MicroRappenPerRappen {
				t.Fatalf("personal balance_microrappen = %d, want untouched %d", got, seedBalanceRappen*billing.MicroRappenPerRappen)
			}
			count, err := app.CountRecords("balance_transactions")
			if err != nil {
				t.Fatalf("CountRecords(balance_transactions) error = %v", err)
			}
			if count != 0 {
				t.Fatalf("balance_transactions count = %d, want 0 — nothing may be metered on a blocked request", count)
			}
			messages, err := app.CountRecords("messages")
			if err != nil {
				t.Fatalf("CountRecords(messages) error = %v", err)
			}
			if messages != 0 {
				t.Fatalf("messages count = %d, want 0 — the lapse gate must block before persistence", messages)
			}
		},
	}

	scenario.Test(t)
}

func TestOrgCompletionBlockedWhileProjectKeyRotationPending(t *testing.T) {
	t.Parallel()

	conversationID := "orgrotationcv01"
	var conversationPublicKey [32]byte
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			t.Fatal("Complete() must not be called while Project key rotation is pending")
			return gateway.CompleteResponse{}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "org project completion fails closed while key rotation is pending",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus:  http.StatusLocked,
		ExpectedContent: []string{`"message":"Project key rotation must finish before new content can be written."`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
				ConversationRepo: stubConversationRepo{
					byID: func(id string) (chat.Conversation, error) {
						return chat.Conversation{ID: id, PublicKey: conversationPublicKey}, nil
					},
				},
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			conversationPublicKey = seedOrgConversationFixture(
				t, app,
				"orgrotation0001", "Rotate GmbH", "orgrotationpj01", conversationID,
				"test1@example.com",
			)
			project, err := app.FindRecordById("projects", "orgrotationpj01")
			if err != nil {
				t.Fatalf("FindRecordById(projects) error = %v", err)
			}
			project.Set("rotation_pending", true)
			if err := app.Save(project); err != nil {
				t.Fatalf("Save(project) error = %v", err)
			}
		},
	}

	scenario.Test(t)
}

// Past-due org: still plan_type payg, but dunning failed — the gate must
// block with the org past-due code before any provider call (§7.6 read-only).
func TestOrgCompletionPastDueFailsClosed(t *testing.T) {
	t.Parallel()

	conversationID := "orgpastduecv001"
	var conversationPublicKey [32]byte

	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			t.Fatal("Complete() must not be called for a past-due org")
			return gateway.CompleteResponse{}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "org project completion with a past-due subscription fails closed",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusPaymentRequired,
		ExpectedContent: []string{
			`"error":"ORG_BILLING_PAST_DUE"`,
			`"organisation_name":"Acme GmbH"`,
			`"admin_message":"Update the payment method for Acme GmbH to restore access."`,
			`"next_step":"org_update_payment"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
				ConversationRepo: stubConversationRepo{
					byID: func(id string) (chat.Conversation, error) {
						return chat.Conversation{ID: id, PublicKey: conversationPublicKey}, nil
					},
				},
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			conversationPublicKey = seedOrgConversationFixture(
				t, app,
				"orgpastdue00001", "Acme GmbH", "orgpastduepj001", conversationID,
				"test1@example.com",
			)
			seedOrgBilling(t, app, "orgpastdue00001", "payg", true, 2)
		},
	}

	scenario.Test(t)
}

// Healthy org: the completion succeeds, the ledger row is attributed to the
// Organisation AND the acting Account, and nobody's personal balance moves.
func TestOrgCompletionRecordsOrgAttributedUsage(t *testing.T) {
	t.Parallel()

	conversationID := "orgusagecv00001"
	var conversationPublicKey [32]byte
	const seedBalanceRappen = 500

	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "org reply"},
				Usage:   gateway.Usage{InputTokens: 7, OutputTokens: 3, TotalTokens: 10},
			}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "org project completion meters usage against the organisation",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"content":"org reply"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
				ConversationRepo: stubConversationRepo{
					byID: func(id string) (chat.Conversation, error) {
						return chat.Conversation{ID: id, PublicKey: conversationPublicKey}, nil
					},
				},
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedUserBillingBalance(t, app, "test1@example.com", "trial", seedBalanceRappen)
			conversationPublicKey = seedOrgConversationFixture(
				t, app,
				"orgusage0000001", "Acme GmbH", "orgusagepj00001", conversationID,
				"test1@example.com",
			)
			seedOrgBilling(t, app, "orgusage0000001", "payg", false, 3)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			user, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail error = %v", err)
			}

			row, err := app.FindFirstRecordByFilter(
				"balance_transactions",
				"organisation = {:org}",
				dbx.Params{"org": "orgusage0000001"},
			)
			if err != nil {
				t.Fatalf("no org-attributed balance_transactions row: %v", err)
			}
			if got := row.GetString("user_id"); got != user.Id {
				t.Errorf("ledger user_id = %q, want the acting account %q", got, user.Id)
			}
			if got := row.GetString("plan_type"); got != "payg" {
				t.Errorf("ledger plan_type = %q, want %q", got, "payg")
			}
			if got := int64(row.GetInt("amount_microrappen")); got >= 0 {
				t.Errorf("ledger amount_microrappen = %d, want negative accrual toward the pooled cycle", got)
			}
			if row.GetString("balance_after_microrappen") != "" && row.GetInt("balance_after_microrappen") != 0 {
				t.Errorf("ledger balance_after_microrappen = %v, want unset — orgs have no balance", row.Get("balance_after_microrappen"))
			}

			// The member's personal trial balance must be exactly as seeded.
			if got := personalBalanceMicroRappen(t, app, "test1@example.com"); got != seedBalanceRappen*billing.MicroRappenPerRappen {
				t.Fatalf("personal balance_microrappen = %d, want untouched %d", got, seedBalanceRappen*billing.MicroRappenPerRappen)
			}
		},
	}

	scenario.Test(t)
}

// Access is participant-based; billing is scope-based. A member whose org
// membership was revoked but who is still a Project participant continues to
// bill the Organisation — never their own Account — until offboarding also
// removes their participation.
func TestOrgCompletionRevokedMembershipStillBillsOrg(t *testing.T) {
	t.Parallel()

	conversationID := "orgrevokedcv001"
	var conversationPublicKey [32]byte
	const seedBalanceRappen = 500

	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "still org billed"},
				Usage:   gateway.Usage{InputTokens: 7, OutputTokens: 3, TotalTokens: 10},
			}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "revoked org membership with surviving participation still bills the org",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"content":"still org billed"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
				ConversationRepo: stubConversationRepo{
					byID: func(id string) (chat.Conversation, error) {
						return chat.Conversation{ID: id, PublicKey: conversationPublicKey}, nil
					},
				},
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test2@example.com")(t, app, e)
			seedUserBillingBalance(t, app, "test2@example.com", "trial", seedBalanceRappen)
			conversationPublicKey = seedOrgConversationFixture(
				t, app,
				"orgrevoked00001", "Acme GmbH", "orgrevokedpj001", conversationID,
				"test1@example.com",
			)
			seedOrgBilling(t, app, "orgrevoked00001", "payg", false, 2)

			// test2 was a member (now revoked) but is still a participant.
			seedOrgMembership(t, app, "orgrevoked00001", "test2@example.com", "member", true)
			member, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail error = %v", err)
			}
			seedProjectParticipant(t, app, "orgrevokedpj001", member.Id, "Editor")
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			member, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail error = %v", err)
			}

			row, err := app.FindFirstRecordByFilter(
				"balance_transactions",
				"organisation = {:org}",
				dbx.Params{"org": "orgrevoked00001"},
			)
			if err != nil {
				t.Fatalf("no org-attributed balance_transactions row: %v", err)
			}
			if got := row.GetString("user_id"); got != member.Id {
				t.Errorf("ledger user_id = %q, want the typing (revoked) member %q for audit", got, member.Id)
			}
			if got := personalBalanceMicroRappen(t, app, "test2@example.com"); got != seedBalanceRappen*billing.MicroRappenPerRappen {
				t.Fatalf("personal balance_microrappen = %d, want untouched %d", got, seedBalanceRappen*billing.MicroRappenPerRappen)
			}
		},
	}

	scenario.Test(t)
}

// Image generation shares the same gate: a lapsed org blocks the paid
// provider call with the same ORG_* 402 contract.
func TestOrgImageGenerationFailsClosed(t *testing.T) {
	t.Parallel()

	conversationID := "orgimagecv00001"
	var conversationPublicKey [32]byte

	gatewayClient := &gateway.MockClient{
		GenerateImageFunc: func(context.Context, gateway.ImageRequest) (gateway.ImageResponse, error) {
			t.Fatal("GenerateImage() must not be called when the org billing gate blocks")
			return gateway.ImageResponse{}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "org project image generation without org billing fails closed",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/image",
		Body: strings.NewReader(`{
			"model_id":"gemini-2-5-flash-image",
			"prompt":"a watercolour fox"
		}`),
		ExpectedStatus: http.StatusPaymentRequired,
		ExpectedContent: []string{
			`"error":"ORG_BILLING_INACTIVE"`,
			`"organisation_name":"Acme GmbH"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
				ConversationRepo: stubConversationRepo{
					byID: func(id string) (chat.Conversation, error) {
						return chat.Conversation{ID: id, PublicKey: conversationPublicKey}, nil
					},
				},
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedUserBillingBalance(t, app, "test1@example.com", "trial", 500)
			conversationPublicKey = seedOrgConversationFixture(
				t, app,
				"orgimage0000001", "Acme GmbH", "orgimagepj00001", conversationID,
				"test1@example.com",
			)
			// No org_billing row: fail closed.
		},
	}

	scenario.Test(t)
}

// Personal pin with the REAL repo: a standalone conversation keeps billing
// the Account exactly as before orgs existed — trial balance deducted,
// ledger row without any organisation attribution.
func TestPersonalCompletionKeepsLedgerOrganisationEmpty(t *testing.T) {
	t.Parallel()

	conversationID := "personalpincv01"
	var conversationPublicKey [32]byte
	const seedBalanceRappen = 500

	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "personal reply"},
				Usage:   gateway.Usage{InputTokens: 7, OutputTokens: 3, TotalTokens: 10},
			}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "standalone conversation completion stays personally billed",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"content":"personal reply"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
				ConversationRepo: stubConversationRepo{
					byID: func(id string) (chat.Conversation, error) {
						return chat.Conversation{ID: id, PublicKey: conversationPublicKey}, nil
					},
				},
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedUserBillingBalance(t, app, "test1@example.com", "trial", seedBalanceRappen)
			conversationPublicKey = seedConversationRecord(t, app, conversationID)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			user, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail error = %v", err)
			}
			row, err := app.FindFirstRecordByFilter(
				"balance_transactions",
				"user_id = {:user}",
				dbx.Params{"user": user.Id},
			)
			if err != nil {
				t.Fatalf("no personal balance_transactions row: %v", err)
			}
			if got := row.GetString("organisation"); got != "" {
				t.Errorf("ledger organisation = %q, want empty for personal usage", got)
			}
			if got := personalBalanceMicroRappen(t, app, "test1@example.com"); got >= seedBalanceRappen*billing.MicroRappenPerRappen {
				t.Fatalf("personal balance_microrappen = %d, want deducted below %d", got, seedBalanceRappen*billing.MicroRappenPerRappen)
			}
		},
	}

	scenario.Test(t)
}
