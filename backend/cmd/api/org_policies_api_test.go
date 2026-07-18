package main

import (
	"context"
	"encoding/base64"
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// seedOrgPolicies sets the policy fields on an organisation directly.
func seedOrgPolicies(t testing.TB, app *tests.TestApp, orgID, privacyTier string, retentionDays int, mfaRequired bool) {
	t.Helper()

	record, err := app.FindRecordById("organisations", orgID)
	if err != nil {
		t.Fatalf("FindRecordById(organisations, %q) error = %v", orgID, err)
	}
	record.Set("policy_privacy_tier", privacyTier)
	record.Set("policy_retention_days", retentionDays)
	record.Set("policy_mfa_required", mfaRequired)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(org policies) error = %v", err)
	}
}

// seedUserMFA directly flips mfa_enabled on a user record (bypassing the
// normal enrolment flow so tests can control the flag precisely).
func seedUserMFA(t testing.TB, app *tests.TestApp, email string, enabled bool) {
	t.Helper()

	user, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", email, err)
	}
	user.Set("mfa_enabled", enabled)
	if err := app.Save(user); err != nil {
		t.Fatalf("Save(user mfa) error = %v", err)
	}
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/orgs/{id}/policies
// ---------------------------------------------------------------------------

func TestOrgPoliciesPatchRoleGates(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		orgID      string
		authEmail  string
		seed       func(t testing.TB, app *tests.TestApp)
		wantStatus int
		wantBody   string
	}{
		{
			name:      "owner can patch policies",
			orgID:     "orgpolpatch0001",
			authEmail: "test1@example.com",
			seed: func(t testing.TB, app *tests.TestApp) {
				seedOrganisation(t, app, "orgpolpatch0001", "Acme", "test1@example.com")
			},
			wantStatus: http.StatusOK,
			wantBody:   `"policy_mfa_required":true`,
		},
		{
			name:      "admin can patch policies",
			orgID:     "orgpolpatch0002",
			authEmail: "test2@example.com",
			seed: func(t testing.TB, app *tests.TestApp) {
				seedOrganisation(t, app, "orgpolpatch0002", "Acme", "test1@example.com")
				seedOrgMembership(t, app, "orgpolpatch0002", "test2@example.com", "admin", false)
			},
			wantStatus: http.StatusOK,
			wantBody:   `"policy_mfa_required":true`,
		},
		{
			name:      "member cannot patch policies",
			orgID:     "orgpolpatch0003",
			authEmail: "test2@example.com",
			seed: func(t testing.TB, app *tests.TestApp) {
				seedOrganisation(t, app, "orgpolpatch0003", "Acme", "test1@example.com")
				seedOrgMembership(t, app, "orgpolpatch0003", "test2@example.com", "member", false)
			},
			wantStatus: http.StatusForbidden,
			wantBody:   `"message"`,
		},
		{
			name:      "non-member cannot patch policies",
			orgID:     "orgpolpatch0004",
			authEmail: "test2@example.com",
			seed: func(t testing.TB, app *tests.TestApp) {
				seedOrganisation(t, app, "orgpolpatch0004", "Acme", "test1@example.com")
			},
			wantStatus: http.StatusNotFound,
			wantBody:   `"message"`,
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			scenario := tests.ApiScenario{
				Name:            tt.name,
				Method:          http.MethodPatch,
				URL:             "/api/v1/orgs/" + tt.orgID + "/policies",
				Body:            strings.NewReader(`{"policy_mfa_required":true}`),
				ExpectedStatus:  tt.wantStatus,
				ExpectedContent: []string{tt.wantBody},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					tt.seed(t, app)
					withRecordAuth("users", tt.authEmail)(t, app, e)
				},
			}

			scenario.Test(t)
		})
	}
}

func TestOrgPoliciesPatchValidation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		body       string
		wantStatus int
		wantBody   string
	}{
		{
			name:       "invalid privacy tier",
			body:       `{"policy_privacy_tier":"us_only"}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   `"message"`,
		},
		{
			name:       "negative retention days",
			body:       `{"policy_retention_days":-1}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   `"message"`,
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			orgID := "orgpolval000001"

			scenario := tests.ApiScenario{
				Name:            tt.name,
				Method:          http.MethodPatch,
				URL:             "/api/v1/orgs/" + orgID + "/policies",
				Body:            strings.NewReader(tt.body),
				ExpectedStatus:  tt.wantStatus,
				ExpectedContent: []string{tt.wantBody},
				TestAppFactory:  setupTestApp,
				BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
					seedOrganisation(t, app, orgID, "Acme", "test1@example.com")
					withRecordAuth("users", "test1@example.com")(t, app, e)
				},
			}

			scenario.Test(t)
		})
	}
}

// ---------------------------------------------------------------------------
// GET /api/v1/orgs/{id} includes policies
// ---------------------------------------------------------------------------

func TestOrgPoliciesGetIncludesPolicies(t *testing.T) {
	t.Parallel()

	orgID := "orgpolget000001"

	scenario := tests.ApiScenario{
		Name:           "get organisation includes policy fields for member",
		Method:         http.MethodGet,
		URL:            "/api/v1/orgs/" + orgID,
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"policy_privacy_tier":"ch_only"`,
			`"policy_retention_days":30`,
			`"policy_mfa_required":true`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Acme", "test1@example.com")
			seedOrgPolicies(t, app, orgID, "ch_only", 30, true)
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// ORG_MFA_REQUIRED gate
// ---------------------------------------------------------------------------

func TestOrgMFARequiredBlocksProjectAccess(t *testing.T) {
	t.Parallel()

	orgID := "orgmfablock0010"
	projectID := "orgmfablockpj10"

	scenario := tests.ApiScenario{
		Name:           "member without mfa is blocked from org project participants",
		Method:         http.MethodGet,
		URL:            "/api/v1/projects/" + projectID + "/participants",
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`ORG_MFA_REQUIRED`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Acme", "test1@example.com")
			seedOrgPolicies(t, app, orgID, "", 0, true)
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedOrgProject(t, app, projectID, orgID)
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			userRecord, _ := app.FindAuthRecordByEmail("users", "test2@example.com")
			seedProjectParticipant(t, app, projectID, userRecord.Id, "Editor")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrgMFARequiredBlocksCompletion(t *testing.T) {
	t.Parallel()

	orgID := "orgmfablock0020"
	projectID := "orgmfablockpj20"
	conversationID := "orgmfablockcnv0"

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			t.Fatal("gateway should not be called when MFA is required")
			return nil, nil
		},
	}

	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "member without mfa is blocked from completion in org project",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello"}]
		}`),
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`ORG_MFA_REQUIRED`,
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
			seedOrganisation(t, app, orgID, "Acme", "test1@example.com")
			seedOrgPolicies(t, app, orgID, "", 0, true)
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedOrgProject(t, app, projectID, orgID)
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			userRecord, _ := app.FindAuthRecordByEmail("users", "test2@example.com")
			seedProjectParticipant(t, app, projectID, userRecord.Id, "Editor")
			seedOrgBilling(t, app, orgID, "payg", false, 2)
			conversationPublicKey = seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrgMFARequiredPassesWithMFA(t *testing.T) {
	t.Parallel()

	orgID := "orgmfapass00010"
	projectID := "orgmfapasspj100"
	conversationID := "orgmfapasscnv00"

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			ch := make(chan gateway.CompleteStreamEvent, 2)
			ch <- gateway.CompleteStreamEvent{Delta: "answer"}
			ch <- gateway.CompleteStreamEvent{Usage: &gateway.Usage{OutputTokens: 1}}
			close(ch)
			return ch, nil
		},
	}

	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "member with mfa passes the org mfa gate",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello"}]
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"type":"complete"`},
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
			seedOrganisation(t, app, orgID, "Acme", "test1@example.com")
			seedOrgPolicies(t, app, orgID, "", 0, true)
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedOrgProject(t, app, projectID, orgID)
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			userRecord, _ := app.FindAuthRecordByEmail("users", "test2@example.com")
			seedProjectParticipant(t, app, projectID, userRecord.Id, "Editor")
			seedOrgBilling(t, app, orgID, "payg", false, 2)
			seedUserMFA(t, app, "test2@example.com", true)
			conversationPublicKey = seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// ORG_PRIVACY_TIER ceiling
// ---------------------------------------------------------------------------

func TestOrgPrivacyTierCeilingBlocksCompletion(t *testing.T) {
	t.Parallel()

	orgID := "orgprivblock010"
	projectID := "orgprivblockpj0"
	conversationID := "orgprivblockcn0"

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			t.Fatal("gateway should not be called when org privacy tier blocks")
			return nil, nil
		},
	}

	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "org ch_only ceiling blocks eu/global model completion",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"global-model-001",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello"}]
		}`),
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`ORG_PRIVACY_TIER`,
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
			userRecord, _ := app.FindAuthRecordByEmail("users", "test2@example.com")
			userRecord.Set("privacy_tier", "global")
			if err := app.Save(userRecord); err != nil {
				t.Fatalf("set global tier: %v", err)
			}

			seedOrganisation(t, app, orgID, "Acme", "test1@example.com")
			seedOrgPolicies(t, app, orgID, "ch_only", 0, false)
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedOrgProject(t, app, projectID, orgID)
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			seedProjectParticipant(t, app, projectID, userRecord.Id, "Editor")
			seedOrgBilling(t, app, orgID, "payg", false, 2)

			providerID := seedAIProvider(t, app, providerSeed{
				ProviderID:        "openai",
				Name:              "OpenAI",
				Enabled:           true,
				RoutingProviderID: "openai",
			})
			seedAIModel(t, app, modelSeed{
				ModelID:                   "global-model-001",
				ProviderRecordID:          providerID,
				ProviderModelID:           "openai/gpt-4o",
				Name:                      "Global Model",
				Slug:                      "global-model-001",
				Description:               "A global tier model",
				Enabled:                   true,
				Whitelisted:               true,
				PrivacyTier:               "global",
				SupportsTextCompletion:    true,
				InputContextTokens:        32000,
				InputUSDPerMillionTokens:  1,
				OutputUSDPerMillionTokens: 2,
			})

			conversationPublicKey = seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestOrgPrivacyTierPersonalUnaffected(t *testing.T) {
	t.Parallel()

	conversationID := "orgprivpers0010"

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			ch := make(chan gateway.CompleteStreamEvent, 2)
			ch <- gateway.CompleteStreamEvent{Delta: "answer"}
			ch <- gateway.CompleteStreamEvent{Usage: &gateway.Usage{OutputTokens: 1}}
			close(ch)
			return ch, nil
		},
	}

	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "personal conversation is unaffected by org privacy tier ceiling",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"global-model-002",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello"}]
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"type":"complete"`},
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
			userRecord, _ := app.FindAuthRecordByEmail("users", "test1@example.com")
			userRecord.Set("privacy_tier", "global")
			if err := app.Save(userRecord); err != nil {
				t.Fatalf("set global tier: %v", err)
			}

			providerID := seedAIProvider(t, app, providerSeed{
				ProviderID:        "openai",
				Name:              "OpenAI",
				Enabled:           true,
				RoutingProviderID: "openai",
			})
			seedAIModel(t, app, modelSeed{
				ModelID:                   "global-model-002",
				ProviderRecordID:          providerID,
				ProviderModelID:           "openai/gpt-4o",
				Name:                      "Global Model",
				Slug:                      "global-model-002",
				Description:               "A global tier model",
				Enabled:                   true,
				Whitelisted:               true,
				PrivacyTier:               "global",
				SupportsTextCompletion:    true,
				InputContextTokens:        32000,
				InputUSDPerMillionTokens:  1,
				OutputUSDPerMillionTokens: 2,
			})

			conversationPublicKey = seedConversationRecord(t, app, conversationID)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

// ---------------------------------------------------------------------------
// Retention default
// ---------------------------------------------------------------------------

func TestOrgRetentionDefaultOnConversationCreate(t *testing.T) {
	t.Parallel()

	orgID := "orgretcreate001"
	projectID := "orgretcreatepj1"

	encodedData := base64.StdEncoding.EncodeToString([]byte(`{"title":"Org chat"}`))
	publicKey := base64.StdEncoding.EncodeToString([]byte("0123456789012345678901234567890A"))
	wrappedSecret := base64.StdEncoding.EncodeToString([]byte("wrapped-conv-secret"))

	scenario := tests.ApiScenario{
		Name:   "creating conversation in org project applies retention default",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/conversations",
		Body: strings.NewReader(`{
			"data":"` + encodedData + `",
			"public_key":"` + publicKey + `",
			"wrapped_conversation_secret_key":"` + wrappedSecret + `"
		}`),
		ExpectedStatus:  http.StatusCreated,
		ExpectedContent: []string{"project"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Acme", "test1@example.com")
			seedOrgPolicies(t, app, orgID, "", 7, false)
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedOrgProject(t, app, projectID, orgID)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			conversations, err := app.FindRecordsByFilter(
				"conversations",
				"project = {:p}",
				"",
				10,
				0,
				dbx.Params{"p": projectID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(conversations) error = %v", err)
			}
			if len(conversations) != 1 {
				t.Fatalf("project conversations len = %d, want 1", len(conversations))
			}
			conv := conversations[0]
			if got := conv.GetString("expiry_duration"); got != "168h" {
				t.Fatalf("conversation expiry_duration = %q, want %q (org default applied)", got, "168h")
			}
		},
	}

	scenario.Test(t)
}

func TestOrgRetentionDefaultOnMove(t *testing.T) {
	t.Parallel()

	orgID := "orgretmove00010"
	projectID := "orgretmovepj100"
	conversationID := "orgretmovecnv10"

	scenario := tests.ApiScenario{
		Name:   "moving conversation into org project applies retention default",
		Method: http.MethodPatch,
		URL:    "/api/v1/conversations/" + conversationID + "/project",
		Body: strings.NewReader(`{
			"project_id":"` + projectID + `",
			"wrapped_conversation_secret_key":"` + base64.StdEncoding.EncodeToString([]byte("wrapped")) + `"
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"expiry_duration"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Acme", "test1@example.com")
			seedOrgPolicies(t, app, orgID, "", 7, false)
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedOrgProject(t, app, projectID, orgID)
			seedConversationRecord(t, app, conversationID)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			record, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			if got := record.GetString("expiry_duration"); got != "168h" {
				t.Fatalf("conversation expiry_duration = %q, want %q after move into org project", got, "168h")
			}
		},
	}

	scenario.Test(t)
}

func TestOrgRetentionShorterOwnWins(t *testing.T) {
	t.Parallel()

	orgID := "orgretwin000010"
	projectID := "orgretwinpj0010"
	conversationID := "orgretwincnv010"

	scenario := tests.ApiScenario{
		Name:   "existing shorter retention wins over org default",
		Method: http.MethodPatch,
		URL:    "/api/v1/conversations/" + conversationID + "/project",
		Body: strings.NewReader(`{
			"project_id":"` + projectID + `",
			"wrapped_conversation_secret_key":"` + base64.StdEncoding.EncodeToString([]byte("wrapped")) + `"
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"expiry_duration"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Acme", "test1@example.com")
			seedOrgPolicies(t, app, orgID, "", 7, false)
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedOrgProject(t, app, projectID, orgID)
			seedConversationRecord(t, app, conversationID)

			record, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			record.Set("expiry_duration", "24h")
			if err := app.Save(record); err != nil {
				t.Fatalf("Save(conversation with expiry) error = %v", err)
			}

			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			record, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			if got := record.GetString("expiry_duration"); got != "24h" {
				t.Fatalf("conversation expiry_duration = %q, want %q (existing shorter retention must win)", got, "24h")
			}
		},
	}

	scenario.Test(t)
}

func TestOrgRetentionLongerOwnLoses(t *testing.T) {
	t.Parallel()

	orgID := "orgretlose00010"
	projectID := "orgretlosepj100"
	conversationID := "orgretlosecnv10"

	scenario := tests.ApiScenario{
		Name:   "existing longer retention loses to org default",
		Method: http.MethodPatch,
		URL:    "/api/v1/conversations/" + conversationID + "/project",
		Body: strings.NewReader(`{
			"project_id":"` + projectID + `",
			"wrapped_conversation_secret_key":"` + base64.StdEncoding.EncodeToString([]byte("wrapped")) + `"
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{"expiry_duration"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Acme", "test1@example.com")
			seedOrgPolicies(t, app, orgID, "", 7, false)
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedOrgProject(t, app, projectID, orgID)
			seedConversationRecord(t, app, conversationID)

			record, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			record.Set("expiry_duration", "2160h")
			if err := app.Save(record); err != nil {
				t.Fatalf("Save(conversation with expiry) error = %v", err)
			}

			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			record, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			if got := record.GetString("expiry_duration"); got != "168h" {
				t.Fatalf("conversation expiry_duration = %q, want %q (org default must overwrite longer existing)", got, "168h")
			}
		},
	}

	scenario.Test(t)
}
