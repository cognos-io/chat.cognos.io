package main

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
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

	upstream := stubUpstream{
		response: oai.ChatCompletionResponse{
			Usage: oai.Usage{PromptTokens: 123, CompletionTokens: 45, TotalTokens: 168},
		},
		text: "hello back",
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
				UpstreamRepo:   stubUpstreamRepo{upstream: upstream},
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

	upstream := stubUpstream{
		response: oai.ChatCompletionResponse{
			Usage: oai.Usage{PromptTokens: 9, CompletionTokens: 4, TotalTokens: 13},
		},
		text: "temporary reply",
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
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				UpstreamRepo:   stubUpstreamRepo{upstream: upstream},
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

func TestConversationCompleteCleansUpRequestMessageOnProviderError(t *testing.T) {
	t.Parallel()

	conversationID := "convcomp0000002"
	upstream := stubUpstream{err: errors.New("provider down")}
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
				UpstreamRepo:   stubUpstreamRepo{upstream: upstream},
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
