package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"golang.org/x/crypto/nacl/box"
)

func TestProjectConversationCreate(t *testing.T) {
	t.Parallel()

	projectID := "projconvown0001"
	encodedData := base64.StdEncoding.EncodeToString([]byte(`{"title":"Kickoff"}`))
	publicKey := base64.StdEncoding.EncodeToString([]byte("0123456789012345678901234567890A"))
	wrappedSecret := base64.StdEncoding.EncodeToString([]byte("wrapped-conv-secret"))

	scenario := tests.ApiScenario{
		Name:   "create a conversation inside a project",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/conversations",
		Body: strings.NewReader(`{
			"data":"` + encodedData + `",
			"public_key":"` + publicKey + `",
			"wrapped_conversation_secret_key":"` + wrappedSecret + `"
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"data":"` + encodedData + `"`,
			`"project":"` + projectID + `"`,
			`"wrapped_conversation_secret_key":"` + wrappedSecret + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
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

			// A conversation_public_keys row must exist so completion can seal
			// AI responses.
			if _, err := app.FindFirstRecordByFilter(
				"conversation_public_keys",
				"conversation = {:c}",
				dbx.Params{"c": conv.Id},
			); err != nil {
				t.Fatalf("conversation public key not stored: %v", err)
			}

			// A project_conversation_keys row must exist with the wrapped key.
			wrapping, err := app.FindFirstRecordByFilter(
				"project_conversation_keys",
				"conversation = {:c}",
				dbx.Params{"c": conv.Id},
			)
			if err != nil {
				t.Fatalf("project conversation key not stored: %v", err)
			}
			if got := wrapping.GetString("wrapped_conversation_secret_key"); got != wrappedSecret {
				t.Fatalf("wrapped_conversation_secret_key = %q, want %q", got, wrappedSecret)
			}

			// Project conversations carry NO conversation-participant row —
			// access is via project membership only.
			participantRows, err := app.FindRecordsByFilter(
				"participants",
				"conversation = {:c}",
				"",
				10,
				0,
				dbx.Params{"c": conv.Id},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(participants) error = %v", err)
			}
			if len(participantRows) != 0 {
				t.Fatalf("project conversation has %d participant rows, want 0", len(participantRows))
			}
		},
	}

	scenario.Test(t)
}

func TestProjectConversationCreateNonMemberReturnsNotFound(t *testing.T) {
	t.Parallel()

	projectID := "projconvown0002"
	encodedData := base64.StdEncoding.EncodeToString([]byte(`{"title":"Sneaky"}`))
	publicKey := base64.StdEncoding.EncodeToString([]byte("0123456789012345678901234567890A"))
	wrappedSecret := base64.StdEncoding.EncodeToString([]byte("wrapped"))

	scenario := tests.ApiScenario{
		Name:   "non-member cannot create a project conversation",
		Method: http.MethodPost,
		URL:    "/api/v1/projects/" + projectID + "/conversations",
		Body: strings.NewReader(`{
			"data":"` + encodedData + `",
			"public_key":"` + publicKey + `",
			"wrapped_conversation_secret_key":"` + wrappedSecret + `"
		}`),
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

func TestProjectConversationCreateViewerForbidden(t *testing.T) {
	t.Parallel()

	projectID := "projconvown0003"
	encodedData := base64.StdEncoding.EncodeToString([]byte(`{"title":"ReadOnly"}`))
	publicKey := base64.StdEncoding.EncodeToString([]byte("0123456789012345678901234567890A"))
	wrappedSecret := base64.StdEncoding.EncodeToString([]byte("wrapped"))

	scenario := tests.ApiScenario{
		Name:            "viewer member cannot create a project conversation",
		Method:          http.MethodPost,
		URL:             "/api/v1/projects/" + projectID + "/conversations",
		Body:            strings.NewReader(`{"data":"` + encodedData + `","public_key":"` + publicKey + `","wrapped_conversation_secret_key":"` + wrappedSecret + `"}`),
		ExpectedStatus:  http.StatusForbidden,
		ExpectedContent: []string{`Viewers cannot create project conversations`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			guest, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(test2) = %v", err)
			}
			seedProjectParticipant(t, app, projectID, guest.Id, "Viewer")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectConversationsListEmbedsWrappedKey(t *testing.T) {
	t.Parallel()

	projectID := "projconvown0004"
	conversationID := "projconv0000001"

	scenario := tests.ApiScenario{
		Name:           "list project conversations embeds the wrapped secret key",
		Method:         http.MethodGet,
		URL:            "/api/v1/projects/" + projectID + "/conversations",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + conversationID + `"`,
			`"wrapped_conversation_secret_key":"` + base64.StdEncoding.EncodeToString([]byte("wrapped-conv")) + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectConversationMessagesAccessibleToProjectMember(t *testing.T) {
	t.Parallel()

	projectID := "projconvown0005"
	conversationID := "projconv0000002"
	messageID := "projmsg00000001"

	scenario := tests.ApiScenario{
		Name:           "a project member (non-creator) can list a project conversation's messages",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/messages",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + messageID + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			seedMessage(t, app, messageID, conversationID, false)
			// test2 is a project member but has NO conversation-participant row.
			guest, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(test2) = %v", err)
			}
			seedProjectParticipant(t, app, projectID, guest.Id, "Editor")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectConversationMessagesNonMemberReturnsNotFound(t *testing.T) {
	t.Parallel()

	projectID := "projconvown0006"
	conversationID := "projconv0000003"
	messageID := "projmsg00000002"

	scenario := tests.ApiScenario{
		Name:            "a non-member cannot list a project conversation's messages",
		Method:          http.MethodGet,
		URL:             "/api/v1/conversations/" + conversationID + "/messages",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Conversation not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			seedMessage(t, app, messageID, conversationID, false)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestProjectConversationsExcludedFromMainConversationList(t *testing.T) {
	t.Parallel()

	projectID := "projconvown0007"
	conversationID := "projconv0000004"

	scenario := tests.ApiScenario{
		Name:           "project conversations do not appear in the main conversation list",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations",
		ExpectedStatus: http.StatusOK,
		// test1's only conversation is the project one, which the main list
		// excludes — so the list comes back empty.
		ExpectedContent: []string{`[]`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			bodyBytes, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(response.Body) error = %v", err)
			}
			if strings.Contains(string(bodyBytes), conversationID) {
				t.Fatalf("main conversation list leaked a project conversation: %s", string(bodyBytes))
			}
		},
	}

	scenario.Test(t)
}

func TestConversationProjectUpdateMovesStandaloneIntoProject(t *testing.T) {
	t.Parallel()

	projectID := "projmove0000001"
	conversationID := "moveconv0000001"
	wrappedProjectSecret := base64.StdEncoding.EncodeToString([]byte("wrapped-for-project"))

	scenario := tests.ApiScenario{
		Name:   "move a standalone conversation into a project",
		Method: http.MethodPatch,
		URL:    "/api/v1/conversations/" + conversationID + "/project",
		Body: strings.NewReader(`{
			"project_id":"` + projectID + `",
			"wrapped_conversation_secret_key":"` + wrappedProjectSecret + `"
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + conversationID + `"`,
			`"project":"` + projectID + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedConversationKeyMaterial(
				t,
				app,
				conversationID,
				userID(t, app, "test1@example.com"),
				1,
				base64.StdEncoding.EncodeToString([]byte("public-key")),
				"",
				base64.StdEncoding.EncodeToString([]byte("wrapped-for-account")),
			)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			conversation, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations, %q) error = %v", conversationID, err)
			}
			if got := conversation.GetString("project"); got != projectID {
				t.Fatalf("conversations.project = %q, want %q", got, projectID)
			}
			if got := countRows(t, app, "participants", "conversation = {:c}", dbx.Params{"c": conversationID}); got != 0 {
				t.Fatalf("participants rows after project move = %d, want 0", got)
			}
			if got := countRows(t, app, "conversation_secret_keys", "conversation = {:c}", dbx.Params{"c": conversationID}); got != 0 {
				t.Fatalf("conversation_secret_keys rows after project move = %d, want 0", got)
			}
			wrapping, err := app.FindFirstRecordByFilter(
				"project_conversation_keys",
				"conversation = {:c}",
				dbx.Params{"c": conversationID},
			)
			if err != nil {
				t.Fatalf("FindFirstRecordByFilter(project_conversation_keys) error = %v", err)
			}
			if got := wrapping.GetString("wrapped_conversation_secret_key"); got != wrappedProjectSecret {
				t.Fatalf("wrapped_conversation_secret_key = %q, want %q", got, wrappedProjectSecret)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationProjectUpdateRemovesProjectConversation(t *testing.T) {
	t.Parallel()

	projectID := "projmove0000002"
	conversationID := "moveconv0000002"
	wrappedAccountSecret := base64.StdEncoding.EncodeToString([]byte("wrapped-for-account"))

	scenario := tests.ApiScenario{
		Name:   "remove a conversation from a project",
		Method: http.MethodPatch,
		URL:    "/api/v1/conversations/" + conversationID + "/project",
		Body: strings.NewReader(`{
			"project_id":"",
			"wrapped_secret_key":"` + wrappedAccountSecret + `"
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + conversationID + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			conversation, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations, %q) error = %v", conversationID, err)
			}
			if got := conversation.GetString("project"); got != "" {
				t.Fatalf("conversations.project after removal = %q, want empty", got)
			}
			if got := countRows(t, app, "project_conversation_keys", "conversation = {:c}", dbx.Params{"c": conversationID}); got != 0 {
				t.Fatalf("project_conversation_keys rows after removal = %d, want 0", got)
			}
			participant, err := app.FindFirstRecordByFilter(
				"participants",
				"conversation = {:c} && user = {:u}",
				dbx.Params{"c": conversationID, "u": userID(t, app, "test1@example.com")},
			)
			if err != nil {
				t.Fatalf("FindFirstRecordByFilter(participants) error = %v", err)
			}
			if got := participant.GetString("role"); got != "Admin" {
				t.Fatalf("participants.role after removal = %q, want Admin", got)
			}
			secret, err := app.FindFirstRecordByFilter(
				"conversation_secret_keys",
				"conversation = {:c} && user = {:u}",
				dbx.Params{"c": conversationID, "u": userID(t, app, "test1@example.com")},
			)
			if err != nil {
				t.Fatalf("FindFirstRecordByFilter(conversation_secret_keys) error = %v", err)
			}
			if got := secret.GetString("secret_key"); got != wrappedAccountSecret {
				t.Fatalf("conversation_secret_keys.secret_key = %q, want %q", got, wrappedAccountSecret)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationProjectUpdateRequiresProjectAdmin(t *testing.T) {
	t.Parallel()

	projectID := "projmove0000003"
	conversationID := "moveconv0000003"

	scenario := tests.ApiScenario{
		Name:   "viewer cannot remove a project conversation",
		Method: http.MethodPatch,
		URL:    "/api/v1/conversations/" + conversationID + "/project",
		Body: strings.NewReader(`{
			"project_id":"",
			"wrapped_secret_key":"` + base64.StdEncoding.EncodeToString([]byte("wrapped")) + `"
		}`),
		ExpectedStatus:  http.StatusForbidden,
		ExpectedContent: []string{`Only project admins can move conversations`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			guest, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(test2) = %v", err)
			}
			seedProjectParticipant(t, app, projectID, guest.Id, "Viewer")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			conversation, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations, %q) error = %v", conversationID, err)
			}
			if got := conversation.GetString("project"); got != projectID {
				t.Fatalf("conversations.project after forbidden removal = %q, want %q", got, projectID)
			}
		},
	}

	scenario.Test(t)
}

func TestProjectConversationCompleteRejectsNonMember(t *testing.T) {
	t.Parallel()

	projectID := "projconvown0008"
	conversationID := "projconv0000005"
	gatewayCalled := false
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			gatewayCalled = true
			return gateway.CompleteResponse{}, nil
		},
	}
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "a non-member cannot complete against a project conversation",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"snoop"}]
		}`),
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Conversation not found or unable to load."`},
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
			seedOwnedProject(t, app, projectID, "test1@example.com")
			conversationPublicKey = seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			// test2 is not a member of the project.
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if gatewayCalled {
				t.Fatalf("gateway Complete was called: access gate must short-circuit before any provider work")
			}
		},
	}

	scenario.Test(t)
}

func TestProjectConversationCompleteAllowsProjectMember(t *testing.T) {
	t.Parallel()

	projectID := "projconvown0009"
	conversationID := "projconv0000006"
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(_ context.Context, _ gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "hello back"},
				Usage:   gateway.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
			}, nil
		},
	}
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "a project member can complete against a project conversation",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello"}]
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"content":"hello back"`},
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
			// test1 is the project Admin (seedOwnedProject), so a member.
			seedOwnedProject(t, app, projectID, "test1@example.com")
			conversationPublicKey = seedProjectConversation(t, app, projectID, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, err := app.FindRecordsByFilter(
				"messages",
				"conversation={:c}",
				"",
				10,
				0,
				dbx.Params{"c": conversationID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(messages) error = %v", err)
			}
			if len(records) != 2 {
				t.Fatalf("project member completion persisted %d messages, want 2", len(records))
			}
		},
	}

	scenario.Test(t)
}

func TestProjectConversationKeysCollectionRulesAreLocked(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	collection, err := app.FindCollectionByNameOrId("project_conversation_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(project_conversation_keys) error = %v", err)
	}
	rules := map[string]*string{
		"list":   collection.ListRule,
		"view":   collection.ViewRule,
		"create": collection.CreateRule,
		"update": collection.UpdateRule,
		"delete": collection.DeleteRule,
	}
	for op, rule := range rules {
		if rule != nil {
			t.Errorf("project_conversation_keys.%s rule = %q, want nil (locked)", op, *rule)
		}
	}
}

func countRows(t testing.TB, app *tests.TestApp, collection, filter string, params dbx.Params) int {
	t.Helper()

	records, err := app.FindRecordsByFilter(collection, filter, "", 500, 0, params)
	if err != nil {
		t.Fatalf("FindRecordsByFilter(%s, %q) error = %v", collection, filter, err)
	}
	return len(records)
}

// seedProjectConversation creates a conversation inside a project mirroring
// ProjectConversationsCreate: the conversation row (project set), its public
// key, and the project-wrapped secret key — and deliberately NO
// conversation-participant row. Returns the conversation public key.
func seedProjectConversation(
	t testing.TB,
	app *tests.TestApp,
	projectID, conversationID, creatorEmail string,
) [32]byte {
	t.Helper()

	userRecord, err := app.FindAuthRecordByEmail("users", creatorEmail)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", creatorEmail, err)
	}

	publicKey, _, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}

	conversationCollection, err := app.FindCollectionByNameOrId("conversations")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversations) error = %v", err)
	}
	conversation := core.NewRecord(conversationCollection)
	conversation.Id = conversationID
	conversation.Set("creator", userRecord.Id)
	conversation.Set("project", projectID)
	conversation.Set("data", base64.StdEncoding.EncodeToString([]byte(`{"title":"Project chat"}`)))
	conversation.Set("key_version", 1)
	if err := app.Save(conversation); err != nil {
		t.Fatalf("Save(project conversation) error = %v", err)
	}

	publicKeysCollection, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) error = %v", err)
	}
	publicKeyRecord := core.NewRecord(publicKeysCollection)
	publicKeyRecord.Set("conversation", conversationID)
	publicKeyRecord.Set("public_key", base64.StdEncoding.EncodeToString(publicKey[:]))
	publicKeyRecord.Set("key_version", 1)
	if err := app.Save(publicKeyRecord); err != nil {
		t.Fatalf("Save(conversation public key) error = %v", err)
	}

	conversationKeysCollection, err := app.FindCollectionByNameOrId("project_conversation_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(project_conversation_keys) error = %v", err)
	}
	wrapping := core.NewRecord(conversationKeysCollection)
	wrapping.Set("project", projectID)
	wrapping.Set("conversation", conversationID)
	wrapping.Set("conversation_key_version", 1)
	wrapping.Set("project_key_version", 1)
	wrapping.Set("wrapped_conversation_secret_key", base64.StdEncoding.EncodeToString([]byte("wrapped-conv")))
	if err := app.Save(wrapping); err != nil {
		t.Fatalf("Save(project conversation key) error = %v", err)
	}

	return *publicKey
}
