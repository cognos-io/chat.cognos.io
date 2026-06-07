package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/aiagent"
	"github.com/cognos-io/chat.cognos.io/backend/pkg/proxy"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	oai "github.com/sashabaranov/go-openai"
	"golang.org/x/crypto/nacl/box"
)

type stubUpstreamRepo struct {
	upstream proxy.Upstream
	err      error
}

func (r stubUpstreamRepo) Provider(provider string) (proxy.Upstream, error) {
	if r.err != nil {
		return nil, r.err
	}
	return r.upstream, nil
}

type stubUpstream struct {
	response       oai.ChatCompletionResponse
	text           string
	err            error
	noRetentionErr error
}

func (u stubUpstream) LookupModel(internalModel string) (string, error) {
	return internalModel, nil
}

func (u stubUpstream) EnsureNoRetention() error {
	return u.noRetentionErr
}

func (u stubUpstream) ChatCompletion(
	_ *core.RequestEvent,
	_ oai.ChatCompletionRequest,
) (oai.ChatCompletionResponse, string, error) {
	return u.response, u.text, u.err
}

type stubConversationRepo struct {
	byID func(id string) (chat.Conversation, error)
}

func (r stubConversationRepo) ByID(id string) (chat.Conversation, error) {
	return r.byID(id)
}

func (r stubConversationRepo) SetConversationUpdated(conversationID string) error {
	return nil
}

func TestCompletionsRequireAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "first-party completions require record auth",
		Method:          http.MethodPost,
		URL:             "/api/v1/completions",
		Body:            strings.NewReader(`{"model_id":"llama-3-3-infomaniak","agent_id":"cognos:simple-assistant","messages":[{"role":"user","content":"hello"}]}`),
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

func TestConversationCompletePersistsEncryptedMessages(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(_ context.Context, req gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			if req.ProviderID != "infomaniak" {
				t.Fatalf("Complete() ProviderID = %q, want %q", req.ProviderID, "infomaniak")
			}
			if req.ProviderModelID != "llama-3.3-70b-instruct" {
				t.Fatalf("Complete() ProviderModelID = %q, want %q", req.ProviderModelID, "llama-3.3-70b-instruct")
			}
			if len(req.Messages) != 2 {
				t.Fatalf("Complete() len(Messages) = %d, want %d", len(req.Messages), 2)
			}
			if req.Messages[0].Role != "system" {
				t.Fatalf("Complete() Messages[0].Role = %q, want %q", req.Messages[0].Role, "system")
			}
			if req.Messages[1].Content != "hello there" {
				t.Fatalf("Complete() Messages[1].Content = %q, want %q", req.Messages[1].Content, "hello there")
			}

			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "hello back"},
				Usage:   gateway.Usage{InputTokens: 123, OutputTokens: 45, TotalTokens: 168},
			}, nil
		},
	}

	conversationID := "convcomp0000001"
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "conversation complete persists encrypted user and assistant messages",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"agent_id":"cognos:simple-assistant",
			"request_id":"req-1",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"request_id":"req-1"`,
			`"content":"hello back"`,
			`"input_tokens":123`,
			`"output_tokens":45`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				UpstreamRepo:   stubUpstreamRepo{upstream: stubUpstream{}},
				GatewayClient:  gatewayClient,
				AIAgentRepo:    aiagent.NewInMemoryAIAgentRepo(nil),
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
			conversationPublicKey = seedConversationRecord(t, app, conversationID)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, err := app.FindRecordsByFilter(
				"messages",
				"conversation={:conversation}",
				"",
				10,
				0,
				dbx.Params{"conversation": conversationID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(messages) error = %v", err)
			}
			if len(records) != 2 {
				t.Fatalf("FindRecordsByFilter(messages) len = %d, want %d", len(records), 2)
			}
			for i, record := range records {
				ciphertext := record.GetString("data")
				if strings.Contains(ciphertext, "hello there") || strings.Contains(ciphertext, "hello back") {
					t.Fatalf("messages[%d].data contains plaintext, got %q", i, ciphertext)
				}
			}
		},
	}

	scenario.Test(t)
}

func TestCompletionsTemporaryDoesNotPersistMessages(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.42
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(_ context.Context, req gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			if len(req.Messages) != 2 {
				t.Fatalf("Complete() len(Messages) = %d, want %d", len(req.Messages), 2)
			}
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "temporary reply"},
				Usage: gateway.Usage{
					InputTokens:              9,
					OutputTokens:             4,
					TotalTokens:              13,
					CacheCreationInputTokens: 7,
					CacheReadInputTokens:     11,
					ProviderCostUSD:          &providerCostUSD,
				},
			}, nil
		},
	}
	var initialCount int64

	scenario := tests.ApiScenario{
		Name:   "generic completions do not persist messages",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"agent_id":"cognos:simple-assistant",
			"request_id":"req-temp",
			"messages":[{"role":"user","content":"temporary chat"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"request_id":"req-temp"`,
			`"content":"temporary reply"`,
			`"cache_creation_input_tokens":7`,
			`"cache_read_input_tokens":11`,
			`"cost_usd":0.42`,
			`"cost_chf":0.42`,
			`"cost_rappen":42`,
			`"used_provider_cost":true`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				UpstreamRepo:   stubUpstreamRepo{upstream: stubUpstream{}},
				GatewayClient:  gatewayClient,
				AIAgentRepo:    aiagent.NewInMemoryAIAgentRepo(nil),
				BillingService: billing.NewService(),
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			count, err := app.CountRecords("messages")
			if err != nil {
				t.Fatalf("CountRecords(messages) error = %v", err)
			}
			initialCount = count
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			count, err := app.CountRecords("messages")
			if err != nil {
				t.Fatalf("CountRecords(messages) error = %v", err)
			}
			if count != initialCount {
				t.Fatalf("CountRecords(messages) = %d, want %d", count, initialCount)
			}
		},
	}

	scenario.Test(t)
}

type stubBillingStateRepo struct {
	stateForUser func(userID string) (billing.State, error)
}

func (r stubBillingStateRepo) StateForUser(userID string) (billing.State, error) {
	return r.stateForUser(userID)
}

func TestCompletionsReturnStructuredBillingRestrictionBeforeGatewayCall(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			t.Fatal("Complete() should not be called when billing blocks the request")
			return gateway.CompleteResponse{}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "generic completions return the structured 402 billing contract",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"agent_id":"cognos:simple-assistant",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusPaymentRequired,
		ExpectedContent: []string{
			`"error":"INACTIVE"`,
			`"message":"Choose a plan to keep chatting."`,
			`"next_step":"subscribe"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				UpstreamRepo:   stubUpstreamRepo{upstream: stubUpstream{}},
				GatewayClient:  gatewayClient,
				AIAgentRepo:    aiagent.NewInMemoryAIAgentRepo(nil),
				BillingService: billing.NewService(),
				BillingStateRepo: stubBillingStateRepo{
					stateForUser: func(userID string) (billing.State, error) {
						if userID != "uvi8zmr78j9y5hz" {
							t.Fatalf("StateForUser(%q) unexpected user id", userID)
						}
						return billing.State{PlanType: billing.PlanTypeInactive}, nil
					},
				},
			})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestConversationCompleteCleansUpRequestMessageOnProviderError(t *testing.T) {
	t.Parallel()

	conversationID := "convcomp0000002"
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{}, errors.New("provider down")
		},
	}
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "conversation complete cleans up request message on provider error",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"agent_id":"cognos:simple-assistant",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusServiceUnavailable,
		ExpectedContent: []string{
			`"message":"Failed to process completion."`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				UpstreamRepo:   stubUpstreamRepo{upstream: stubUpstream{}},
				GatewayClient:  gatewayClient,
				AIAgentRepo:    aiagent.NewInMemoryAIAgentRepo(nil),
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
			conversationPublicKey = seedConversationRecord(t, app, conversationID)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			records, err := app.FindRecordsByFilter(
				"messages",
				"conversation={:conversation}",
				"",
				10,
				0,
				dbx.Params{"conversation": conversationID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(messages) error = %v", err)
			}
			if len(records) != 0 {
				t.Fatalf("FindRecordsByFilter(messages) len = %d, want %d", len(records), 0)
			}
		},
	}

	scenario.Test(t)
}

func seedConversationRecord(t testing.TB, app *tests.TestApp, conversationID string) [32]byte {
	t.Helper()

	userRecord, err := app.FindAuthRecordByEmail("users", "test1@example.com")
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, test1@example.com) error = %v", err)
	}

	publicKey, _, err := box.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}

	conversationCollection, err := app.FindCollectionByNameOrId("conversations")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversations) error = %v", err)
	}
	conversationRecord := core.NewRecord(conversationCollection)
	conversationRecord.Id = conversationID
	conversationRecord.Set("creator", userRecord.Id)
	conversationRecord.Set("data", base64.StdEncoding.EncodeToString([]byte(`{"title":"Test"}`)))
	if err := app.Save(conversationRecord); err != nil {
		t.Fatalf("Save(conversationRecord) error = %v", err)
	}

	return *publicKey
}
