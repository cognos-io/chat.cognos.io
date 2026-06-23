package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/cognos-io/chat.cognos.io/backend/internal/analytics"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/chat"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"golang.org/x/crypto/nacl/box"
)

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
		Body:            strings.NewReader(`{"model_id":"llama-3-3-infomaniak","persona_id":"cognos:simple-assistant","system_prompt":"test persona prompt","messages":[{"role":"user","content":"hello"}]}`),
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

func TestCompletionsRejectNonWhitelistedModelBeforeGatewayCall(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			t.Fatal("Complete() should not be called for non-whitelisted models")
			return gateway.CompleteResponse{}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "generic completions reject curated but non-whitelisted models before gateway call",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"non-whitelisted-model",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello"}]
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Invalid model ID."`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			providerID := seedAIProvider(t, app, providerSeed{
				ProviderID:        "openai",
				Name:              "OpenAI",
				Enabled:           true,
				RoutingProviderID: "openai",
			})
			seedAIModel(t, app, modelSeed{
				ModelID:                   "non-whitelisted-model",
				ProviderRecordID:          providerID,
				ProviderModelID:           "openai/gpt-4o-mini",
				Name:                      "Non Whitelisted",
				Slug:                      "non-whitelisted-model",
				Description:               "Should be rejected",
				Enabled:                   true,
				Whitelisted:               false,
				PrivacyTier:               "eu",
				InputContextTokens:        32000,
				InputUSDPerMillionTokens:  1,
				OutputUSDPerMillionTokens: 2,
			})
		},
	}

	scenario.Test(t)
}

func TestCompletionForwardsValidReasoningEffortToGateway(t *testing.T) {
	t.Parallel()

	var gotEffort string
	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, req gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			gotEffort = req.ReasoningEffort
			ch := make(chan gateway.CompleteStreamEvent, 2)
			ch <- gateway.CompleteStreamEvent{Delta: "answer"}
			ch <- gateway.CompleteStreamEvent{Usage: &gateway.Usage{OutputTokens: 1}}
			close(ch)
			return ch, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "completions forward a declared reasoning effort to the gateway",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"reasoning-model",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"reasoning_effort":"high",
			"messages":[{"role":"user","content":"hello"}]
		}`),
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"type":"complete"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedReasoningModel(t, app)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if gotEffort != "high" {
				t.Fatalf("gateway received reasoning effort %q, want %q", gotEffort, "high")
			}
		},
	}

	scenario.Test(t)
}

func TestCompletionRejectsUnsupportedReasoningEffortBeforeGatewayCall(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(context.Context, gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			t.Fatal("gateway must not be called for an unsupported reasoning effort")
			return nil, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "completions reject an effort the model does not declare",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"reasoning-model",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"reasoning_effort":"ultra",
			"messages":[{"role":"user","content":"hello"}]
		}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			`"message":"Reasoning effort is not supported for this model."`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			seedReasoningModel(t, app)
		},
	}

	scenario.Test(t)
}

// seedReasoningModel seeds a whitelisted model that accepts off/low/medium/high
// reasoning efforts, used by the reasoning-effort completion tests.
func seedReasoningModel(t testing.TB, app *tests.TestApp) {
	t.Helper()
	providerID := seedAIProvider(t, app, providerSeed{
		ProviderID:        "openai",
		Name:              "OpenAI",
		Enabled:           true,
		RoutingProviderID: "openai",
	})
	seedAIModel(t, app, modelSeed{
		ModelID:                   "reasoning-model",
		ProviderRecordID:          providerID,
		ProviderModelID:           "openai/o-mini",
		Name:                      "Reasoning Model",
		Slug:                      "reasoning-model",
		Description:               "Accepts a reasoning effort",
		Enabled:                   true,
		Whitelisted:               true,
		PrivacyTier:               "eu",
		InputContextTokens:        64000,
		InputUSDPerMillionTokens:  1,
		OutputUSDPerMillionTokens: 2,
		ReasoningEfforts:          []string{"off", "low", "medium", "high"},
		DefaultReasoningEffort:    "medium",
	})
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
			if req.Messages[0].Content != "test persona prompt" {
				t.Fatalf("Complete() Messages[0].Content = %q, want %q", req.Messages[0].Content, "test persona prompt")
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
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
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

func TestConversationCompleteStreamPersistsEncryptedMessages(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, req gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			if req.ProviderID != "infomaniak" {
				t.Fatalf("CompleteStream() ProviderID = %q, want %q", req.ProviderID, "infomaniak")
			}
			if req.ProviderModelID != "llama-3.3-70b-instruct" {
				t.Fatalf("CompleteStream() ProviderModelID = %q, want %q", req.ProviderModelID, "llama-3.3-70b-instruct")
			}
			ch := make(chan gateway.CompleteStreamEvent, 3)
			ch <- gateway.CompleteStreamEvent{Delta: "hello "}
			ch <- gateway.CompleteStreamEvent{Delta: "back"}
			ch <- gateway.CompleteStreamEvent{Usage: &gateway.Usage{InputTokens: 123, OutputTokens: 45, TotalTokens: 168}}
			close(ch)
			return ch, nil
		},
	}

	conversationID := "convstream00001"
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:           "conversation complete stream persists encrypted messages",
		Method:         http.MethodPost,
		URL:            "/api/v1/conversations/" + conversationID + "/complete",
		Body:           strings.NewReader(`{"model_id":"llama-3-3-infomaniak","persona_id":"cognos:simple-assistant","system_prompt":"test persona prompt","request_id":"req-stream-1","messages":[{"role":"user","content":"hello there"}]}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"type":"delta","delta":"hello "`,
			`"type":"complete"`,
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
			conversationPublicKey = seedConversationRecord(t, app, conversationID)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			if got := res.Header.Get("Content-Type"); got != "text/event-stream" {
				t.Fatalf("Content-Type = %q, want %q", got, "text/event-stream")
			}

			bodyBytes, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(stream body) error = %v", err)
			}
			body := string(bodyBytes)
			if !strings.Contains(body, `data: {"type":"delta","delta":"hello "}`) {
				t.Fatalf("stream body missing first delta, got %q", body)
			}
			if !strings.Contains(body, `data: {"type":"delta","delta":"back"}`) {
				t.Fatalf("stream body missing second delta, got %q", body)
			}
			if !strings.Contains(body, `data: {"type":"complete"`) || !strings.Contains(body, `"content":"hello back"`) {
				t.Fatalf("stream body missing completion payload, got %q", body)
			}

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

// disconnectAfterFirstDeltaWriter simulates a client closing the SSE
// connection after the first streamed delta while the handler keeps
// draining the upstream completion.
type disconnectAfterFirstDeltaWriter struct {
	http.ResponseWriter
	flusher       http.Flusher
	deltasWritten int
}

func newDisconnectAfterFirstDeltaWriter(w http.ResponseWriter) *disconnectAfterFirstDeltaWriter {
	flusher, _ := w.(http.Flusher)
	return &disconnectAfterFirstDeltaWriter{
		ResponseWriter: w,
		flusher:        flusher,
	}
}

func (w *disconnectAfterFirstDeltaWriter) Flush() {
	if w.flusher != nil {
		w.flusher.Flush()
	}
}

func (w *disconnectAfterFirstDeltaWriter) Write(p []byte) (int, error) {
	if strings.Contains(string(p), `"type":"delta"`) {
		w.deltasWritten++
		if w.deltasWritten > 1 {
			return 0, errors.New("client disconnected")
		}
	}

	return w.ResponseWriter.Write(p)
}

func TestConversationCompleteStreamPersistsAndBillsAfterClientDisconnect(t *testing.T) {
	t.Parallel()

	ledgerRepo := &recordingLedgerRepo{}
	conversationID := "convdisc0000001"
	var conversationPublicKey [32]byte

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, req gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			if req.ProviderID != "infomaniak" {
				t.Fatalf("CompleteStream() ProviderID = %q, want %q", req.ProviderID, "infomaniak")
			}
			ch := make(chan gateway.CompleteStreamEvent, 3)
			ch <- gateway.CompleteStreamEvent{Delta: "hello "}
			ch <- gateway.CompleteStreamEvent{Delta: "back"}
			ch <- gateway.CompleteStreamEvent{Usage: &gateway.Usage{InputTokens: 123, OutputTokens: 45, TotalTokens: 168}}
			close(ch)
			return ch, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:           "conversation complete stream persists and bills after client disconnect",
		Method:         http.MethodPost,
		URL:            "/api/v1/conversations/" + conversationID + "/complete",
		Body:           strings.NewReader(`{"model_id":"llama-3-3-infomaniak","persona_id":"cognos:simple-assistant","system_prompt":"test persona prompt","request_id":"req-disc-1","messages":[{"role":"user","content":"hello there"}]}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"type":"delta","delta":"hello "`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:     gatewayClient,
				BillingService:    billing.NewService(),
				BillingLedgerRepo: ledgerRepo,
				BillingStateRepo: stubBillingStateRepo{
					stateForUser: func(userID string) (billing.State, error) {
						if userID != "uvi8zmr78j9y5hz" {
							t.Fatalf("StateForUser(%q) unexpected user id", userID)
						}
						return billing.State{PlanType: billing.PlanTypePayG, BalanceRappen: 0}, nil
					},
				},
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
			e.Router.BindFunc(func(re *core.RequestEvent) error {
				if strings.Contains(re.Request.URL.Path, "/complete") {
					re.Response = newDisconnectAfterFirstDeltaWriter(re.Response)
				}
				return re.Next()
			})
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			bodyBytes, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(stream body) error = %v", err)
			}
			body := string(bodyBytes)
			if !strings.Contains(body, `"type":"delta","delta":"hello "`) {
				t.Fatalf("stream body missing first delta, got %q", body)
			}
			if strings.Contains(body, `"type":"complete"`) {
				t.Fatalf("stream body should not include completion after disconnect, got %q", body)
			}

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

			if len(ledgerRepo.records) != 1 {
				t.Fatalf("RecordUsage() count = %d, want %d", len(ledgerRepo.records), 1)
			}
			record := ledgerRepo.records[0]
			if record.InputTokens != 123 || record.OutputTokens != 45 {
				t.Fatalf("ledger usage = %+v, want input=123 output=45", record)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationCompleteStopCancelsUpstreamAndPersistsPartial(t *testing.T) {
	conversationID := "convstop0000001"
	requestID := "req-stop-1"
	var conversationPublicKey [32]byte

	started := make(chan struct{})
	ctxCancelled := make(chan struct{})
	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(ctx context.Context, req gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			if req.ProviderID != "infomaniak" {
				t.Fatalf("CompleteStream() ProviderID = %q, want %q", req.ProviderID, "infomaniak")
			}
			out := make(chan gateway.CompleteStreamEvent)
			go func() {
				defer close(out)
				close(started)
				out <- gateway.CompleteStreamEvent{Delta: "partial answer"}
				<-ctx.Done()
				close(ctxCancelled)
			}()
			return out, nil
		},
	}

	app := setupTestAppWithHookParams(t, appHookParams{
		GatewayClient:  gatewayClient,
		BillingService: billing.NewService(),
		ConversationRepo: stubConversationRepo{
			byID: func(id string) (chat.Conversation, error) {
				return chat.Conversation{ID: id, PublicKey: conversationPublicKey}, nil
			},
		},
	})
	defer app.Cleanup()
	conversationPublicKey = seedConversationRecord(t, app, conversationID)

	baseRouter, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("apis.NewRouter: %v", err)
	}

	var mux http.Handler
	serveEvent := &core.ServeEvent{App: app, Router: baseRouter}
	if err := app.OnServe().Trigger(serveEvent, func(e *core.ServeEvent) error {
		withRecordAuth("users", "test1@example.com")(t, app, e)
		built, err := e.Router.BuildMux()
		mux = built
		return err
	}); err != nil {
		t.Fatalf("OnServe trigger: %v", err)
	}

	server := httptest.NewServer(mux)
	defer server.Close()

	type completionResult struct {
		status int
		body   string
		err    error
	}
	completionDone := make(chan completionResult, 1)
	go func() {
		resp, err := http.Post(
			server.URL+"/api/v1/conversations/"+conversationID+"/complete",
			"application/json",
			strings.NewReader(`{"model_id":"llama-3-3-infomaniak","persona_id":"cognos:simple-assistant","system_prompt":"test persona prompt","request_id":"`+requestID+`","messages":[{"role":"user","content":"hello there"}]}`),
		)
		if err != nil {
			completionDone <- completionResult{err: err}
			return
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		completionDone <- completionResult{status: resp.StatusCode, body: string(body), err: err}
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("CompleteStream() did not start")
	}

	stopResp, err := http.Post(
		server.URL+"/api/v1/completions/"+requestID+"/stop",
		"application/json",
		nil,
	)
	if err != nil {
		t.Fatalf("POST stop error = %v", err)
	}
	defer stopResp.Body.Close()
	if stopResp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(stopResp.Body)
		t.Fatalf("POST stop status = %d, want %d — body: %s", stopResp.StatusCode, http.StatusNoContent, body)
	}

	select {
	case <-ctxCancelled:
	case <-time.After(time.Second):
		t.Fatal("upstream context was not cancelled")
	}

	var result completionResult
	select {
	case result = <-completionDone:
	case <-time.After(time.Second):
		t.Fatal("completion stream did not finish after stop")
	}
	if result.err != nil {
		t.Fatalf("completion request error = %v", result.err)
	}
	if result.status != http.StatusOK {
		t.Fatalf("completion status = %d, want %d — body: %s", result.status, http.StatusOK, result.body)
	}
	if !strings.Contains(result.body, `"type":"complete"`) || !strings.Contains(result.body, `"content":"partial answer"`) {
		t.Fatalf("completion body missing partial complete response, got %q", result.body)
	}

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
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"request_id":"req-temp",
			"messages":[{"role":"user","content":"temporary chat"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"request_id":"req-temp"`,
			`"content":"temporary reply"`, // 0.42 USD * 1.22 margin = 0.5124 CHF
			`"cache_creation_input_tokens":7`,
			`"cache_read_input_tokens":11`,
			`"cost_usd":0.5124`,
			`"cost_chf":0.5124`,
			`"cost_rappen":51`,
			`"used_provider_cost":true`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
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

type recordingLedgerRepo struct {
	records []billing.UsageRecord
}

func (r *recordingLedgerRepo) RecordUsage(record billing.UsageRecord) error {
	r.records = append(r.records, record)
	return nil
}

type recordingUsageEmitter struct {
	events []analytics.UsageEvent
}

func (e *recordingUsageEmitter) Emit(event analytics.UsageEvent) error {
	e.events = append(e.events, event)
	return nil
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
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
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
				GatewayClient:  gatewayClient,
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

func TestCompletionsAllowPayGUsersWhenBillingStateIsPresent(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(_ context.Context, req gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			if len(req.Messages) != 2 {
				t.Fatalf("Complete() len(Messages) = %d, want %d", len(req.Messages), 2)
			}
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "payg reply"},
				Usage:   gateway.Usage{InputTokens: 7, OutputTokens: 3, TotalTokens: 10},
			}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "generic completions allow payg users without blocking for funds",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"request_id":"req-payg",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"request_id":"req-payg"`,
			`"content":"payg reply"`,
			`"input_tokens":7`,
			`"output_tokens":3`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
				BillingStateRepo: stubBillingStateRepo{
					stateForUser: func(userID string) (billing.State, error) {
						if userID != "uvi8zmr78j9y5hz" {
							t.Fatalf("StateForUser(%q) unexpected user id", userID)
						}
						return billing.State{PlanType: billing.PlanTypePayG, BalanceRappen: 0}, nil
					},
				},
			})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestCompletionsRecordPayGUsageAfterGatewayCall(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.42
	ledgerRepo := &recordingLedgerRepo{}
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(_ context.Context, _ gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "payg reply"},
				Usage: gateway.Usage{
					InputTokens:     7,
					OutputTokens:    3,
					TotalTokens:     10,
					ProviderCostUSD: &providerCostUSD,
				},
			}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "generic completions record payg usage after provider call",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"content":"payg reply"`,
			`"cost_rappen":51`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:     gatewayClient,
				BillingService:    billing.NewService(),
				BillingLedgerRepo: ledgerRepo,
				BillingStateRepo: stubBillingStateRepo{
					stateForUser: func(userID string) (billing.State, error) {
						if userID != "uvi8zmr78j9y5hz" {
							t.Fatalf("StateForUser(%q) unexpected user id", userID)
						}
						return billing.State{PlanType: billing.PlanTypePayG, BalanceRappen: 0}, nil
					},
				},
			})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if len(ledgerRepo.records) != 1 {
				t.Fatalf("RecordUsage() count = %d, want %d", len(ledgerRepo.records), 1)
			}
			record := ledgerRepo.records[0]
			if record.PlanType != billing.PlanTypePayG {
				t.Errorf("RecordUsage().PlanType = %q, want %q", record.PlanType, billing.PlanTypePayG)
			}
			if record.AmountRappen != -51 {
				t.Errorf("RecordUsage().AmountRappen = %d, want %d", record.AmountRappen, -51)
			}
			if record.UserCostRappen != 51 {
				t.Errorf("RecordUsage().UserCostRappen = %d, want %d", record.UserCostRappen, 51)
			}
			// Precise sub-rappen cost: 0.42 USD * 1.22 margin = 0.5124 CHF = 51_240_000 µR.
			if record.UserCostMicroRappen != 51_240_000 {
				t.Errorf("RecordUsage().UserCostMicroRappen = %d, want %d", record.UserCostMicroRappen, 51_240_000)
			}
			if record.AmountMicroRappen != -51_240_000 {
				t.Errorf("RecordUsage().AmountMicroRappen = %d, want %d", record.AmountMicroRappen, -51_240_000)
			}
			if record.ProviderCostRappen != 42 {
				t.Errorf("RecordUsage().ProviderCostRappen = %d, want %d", record.ProviderCostRappen, 42)
			}
			if record.BalanceAfterRappen != nil {
				t.Errorf("RecordUsage().BalanceAfterRappen = %v, want nil", record.BalanceAfterRappen)
			}
		},
	}

	scenario.Test(t)
}

func TestCompletionsRecordUnlimitedUsageWithoutDeduction(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.42
	ledgerRepo := &recordingLedgerRepo{}
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(_ context.Context, _ gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "unlimited reply"},
				Usage: gateway.Usage{
					InputTokens:     7,
					OutputTokens:    3,
					TotalTokens:     10,
					ProviderCostUSD: &providerCostUSD,
				},
			}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "generic completions record unlimited usage metadata without deduction",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"content":"unlimited reply"`,
			`"cost_rappen":51`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:     gatewayClient,
				BillingService:    billing.NewService(),
				BillingLedgerRepo: ledgerRepo,
				BillingStateRepo: stubBillingStateRepo{
					stateForUser: func(userID string) (billing.State, error) {
						if userID != "uvi8zmr78j9y5hz" {
							t.Fatalf("StateForUser(%q) unexpected user id", userID)
						}
						return billing.State{PlanType: billing.PlanTypeUnlimited}, nil
					},
				},
			})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if len(ledgerRepo.records) != 1 {
				t.Fatalf("RecordUsage() count = %d, want %d", len(ledgerRepo.records), 1)
			}
			record := ledgerRepo.records[0]
			if record.PlanType != billing.PlanTypeUnlimited {
				t.Errorf("RecordUsage().PlanType = %q, want %q", record.PlanType, billing.PlanTypeUnlimited)
			}
			if record.AmountRappen != 0 {
				t.Errorf("RecordUsage().AmountRappen = %d, want 0", record.AmountRappen)
			}
			if record.UserCostRappen != 51 {
				t.Errorf("RecordUsage().UserCostRappen = %d, want %d", record.UserCostRappen, 51)
			}
			// Unlimited records the precise cost (for fair-use monitoring) but
			// never debits it.
			if record.UserCostMicroRappen != 51_240_000 {
				t.Errorf("RecordUsage().UserCostMicroRappen = %d, want %d", record.UserCostMicroRappen, 51_240_000)
			}
			if record.AmountMicroRappen != 0 {
				t.Errorf("RecordUsage().AmountMicroRappen = %d, want 0", record.AmountMicroRappen)
			}
		},
	}

	scenario.Test(t)
}

func TestCompletionsRecordTrialUsageAndBalanceAfter(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.10
	ledgerRepo := &recordingLedgerRepo{}
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(_ context.Context, _ gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "trial reply"},
				Usage: gateway.Usage{
					InputTokens:     8,
					OutputTokens:    4,
					TotalTokens:     12,
					ProviderCostUSD: &providerCostUSD,
				},
			}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "generic completions record trial usage with balance after",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"content":"trial reply"`,
			`"cost_rappen":12`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:     gatewayClient,
				BillingService:    billing.NewService(),
				BillingLedgerRepo: ledgerRepo,
				BillingStateRepo: stubBillingStateRepo{
					stateForUser: func(userID string) (billing.State, error) {
						if userID != "uvi8zmr78j9y5hz" {
							t.Fatalf("StateForUser(%q) unexpected user id", userID)
						}
						return billing.State{PlanType: billing.PlanTypeTrial, BalanceRappen: 200, BalanceMicroRappen: 200_000_000}, nil
					},
				},
			})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if len(ledgerRepo.records) != 1 {
				t.Fatalf("RecordUsage() count = %d, want %d", len(ledgerRepo.records), 1)
			}
			record := ledgerRepo.records[0]
			if record.PlanType != billing.PlanTypeTrial {
				t.Errorf("RecordUsage().PlanType = %q, want %q", record.PlanType, billing.PlanTypeTrial)
			}
			if record.AmountRappen != -12 {
				t.Errorf("RecordUsage().AmountRappen = %d, want %d", record.AmountRappen, -12)
			}
			// 0.10 USD * 1.22 margin = 0.122 CHF = 12_200_000 µR debited exactly.
			if record.AmountMicroRappen != -12_200_000 {
				t.Errorf("RecordUsage().AmountMicroRappen = %d, want %d", record.AmountMicroRappen, -12_200_000)
			}
			if record.BalanceAfterMicroRappen == nil {
				t.Fatal("RecordUsage().BalanceAfterMicroRappen = nil, want non-nil")
			}
			if *record.BalanceAfterMicroRappen != 187_800_000 {
				t.Errorf("RecordUsage().BalanceAfterMicroRappen = %d, want %d", *record.BalanceAfterMicroRappen, 187_800_000)
			}
			if record.BalanceAfterRappen == nil {
				t.Fatal("RecordUsage().BalanceAfterRappen = nil, want non-nil")
			}
			// Displayed remaining balance floors down (187.8 -> 187) so we never
			// overstate the credit left.
			if *record.BalanceAfterRappen != 187 {
				t.Errorf("RecordUsage().BalanceAfterRappen = %d, want %d", *record.BalanceAfterRappen, 187)
			}
		},
	}

	scenario.Test(t)
}

func TestCompletionsDoNotRecordUsageWhenBillingBlocksRequest(t *testing.T) {
	t.Parallel()

	ledgerRepo := &recordingLedgerRepo{}
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			t.Fatal("Complete() should not be called when billing blocks the request")
			return gateway.CompleteResponse{}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "generic completions do not record usage when billing blocks the request",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusPaymentRequired,
		ExpectedContent: []string{
			`"error":"INACTIVE"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:     gatewayClient,
				BillingService:    billing.NewService(),
				BillingLedgerRepo: ledgerRepo,
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
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if len(ledgerRepo.records) != 0 {
				t.Fatalf("RecordUsage() count = %d, want %d", len(ledgerRepo.records), 0)
			}
		},
	}

	scenario.Test(t)
}

func TestCompletionsUseFXRateProviderForResponseAndLedger(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.42
	ledgerRepo := &recordingLedgerRepo{}
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(_ context.Context, _ gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "fx reply"},
				Usage: gateway.Usage{
					InputTokens:     7,
					OutputTokens:    3,
					TotalTokens:     10,
					ProviderCostUSD: &providerCostUSD,
				},
			}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "generic completions use the configured fx rate for response and ledger values",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"content":"fx reply"`,
			`"cost_chf":0.46115999999999996`,
			`"cost_rappen":46`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:     gatewayClient,
				BillingService:    billing.NewService(),
				BillingLedgerRepo: ledgerRepo,
				FXRateProvider:    billing.StaticFXRateProvider{Rate: 0.9},
				BillingStateRepo: stubBillingStateRepo{
					stateForUser: func(userID string) (billing.State, error) {
						if userID != "uvi8zmr78j9y5hz" {
							t.Fatalf("StateForUser(%q) unexpected user id", userID)
						}
						return billing.State{PlanType: billing.PlanTypePayG, BalanceRappen: 0}, nil
					},
				},
			})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if len(ledgerRepo.records) != 1 {
				t.Fatalf("RecordUsage() count = %d, want %d", len(ledgerRepo.records), 1)
			}
			record := ledgerRepo.records[0]
			if record.FXRateUSDCHF != 0.9 {
				t.Errorf("RecordUsage().FXRateUSDCHF = %f, want %f", record.FXRateUSDCHF, 0.9)
			}
			if record.ProviderCostRappen != 38 {
				t.Errorf("RecordUsage().ProviderCostRappen = %d, want %d", record.ProviderCostRappen, 38)
			}
			if record.UserCostRappen != 46 {
				t.Errorf("RecordUsage().UserCostRappen = %d, want %d", record.UserCostRappen, 46)
			}
			// 0.42 USD * 1.22 margin * 0.9 fx = 0.46116 CHF = 46_116_000 µR.
			if record.UserCostMicroRappen != 46_116_000 {
				t.Errorf("RecordUsage().UserCostMicroRappen = %d, want %d", record.UserCostMicroRappen, 46_116_000)
			}
		},
	}

	scenario.Test(t)
}

func TestCompletionsEmitUsageEventAfterGatewayCall(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.42
	emitter := &recordingUsageEmitter{}
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(_ context.Context, _ gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			return gateway.CompleteResponse{
				Message: gateway.Message{Role: "assistant", Content: "analytics reply"},
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

	scenario := tests.ApiScenario{
		Name:   "generic completions emit an analytics usage event after provider success",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"content":"analytics reply"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
				UsageEmitter:   emitter,
				BillingStateRepo: stubBillingStateRepo{
					stateForUser: func(userID string) (billing.State, error) {
						if userID != "uvi8zmr78j9y5hz" {
							t.Fatalf("StateForUser(%q) unexpected user id", userID)
						}
						return billing.State{PlanType: billing.PlanTypePayG, BillingUserID: "bill_123"}, nil
					},
				},
			})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if len(emitter.events) != 1 {
				t.Fatalf("Emit() count = %d, want %d", len(emitter.events), 1)
			}
			event := emitter.events[0]
			if event.BillingUserID != "bill_123" {
				t.Errorf("Emit().BillingUserID = %q, want %q", event.BillingUserID, "bill_123")
			}
			if event.PlanType != string(billing.PlanTypePayG) {
				t.Errorf("Emit().PlanType = %q, want %q", event.PlanType, billing.PlanTypePayG)
			}
			if event.ModelID != "llama-3-3-infomaniak" {
				t.Errorf("Emit().ModelID = %q, want %q", event.ModelID, "llama-3-3-infomaniak")
			}
			if event.Provider != "infomaniak" {
				t.Errorf("Emit().Provider = %q, want %q", event.Provider, "infomaniak")
			}
			if event.PrivacyTier != "eu" {
				t.Errorf("Emit().PrivacyTier = %q, want %q", event.PrivacyTier, "eu")
			}
			if event.CacheCreationInputTokens != 7 || event.CacheReadInputTokens != 11 {
				t.Errorf("Emit() cache tokens = (%d, %d), want (%d, %d)", event.CacheCreationInputTokens, event.CacheReadInputTokens, 7, 11)
			}
			if event.ProviderCostUSD != 0.42 {
				t.Errorf("Emit().ProviderCostUSD = %f, want %f", event.ProviderCostUSD, 0.42)
			}
			if event.CostUSD != 0.5124 {
				t.Errorf("Emit().CostUSD = %f, want %f", event.CostUSD, 0.5124)
			}
			if event.CostCHF != 0.5124 {
				t.Errorf("Emit().CostCHF = %f, want %f", event.CostCHF, 0.5124)
			}
			if event.EventID == "" {
				t.Error("Emit().EventID = empty, want non-empty")
			}
		},
	}

	scenario.Test(t)
}

func TestCompletionsReturnTrialExhaustedBeforeGatewayCall(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			t.Fatal("Complete() should not be called when trial credit is exhausted")
			return gateway.CompleteResponse{}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "generic completions return trial exhaustion before provider call",
		Method: http.MethodPost,
		URL:    "/api/v1/completions",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusPaymentRequired,
		ExpectedContent: []string{
			`"error":"TRIAL_EXHAUSTED"`,
			`"message":"Your free trial has been used up."`,
			`"balance_chf":0.02`,
			`"estimated_cost_chf":0.18`,
			`"next_step":"subscribe"`,
		},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:  gatewayClient,
				BillingService: billing.NewService(),
				BillingStateRepo: stubBillingStateRepo{
					stateForUser: func(userID string) (billing.State, error) {
						if userID != "uvi8zmr78j9y5hz" {
							t.Fatalf("StateForUser(%q) unexpected user id", userID)
						}
						return billing.State{PlanType: billing.PlanTypeTrial, BalanceRappen: 2, BalanceMicroRappen: 2_000_000}, nil
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
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusServiceUnavailable,
		ExpectedContent: []string{
			`"message":"Failed to process completion."`,
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

func TestConversationRegeneratePersistsAssistantSibling(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			ch := make(chan gateway.CompleteStreamEvent, 2)
			ch <- gateway.CompleteStreamEvent{Delta: "fresh take"}
			ch <- gateway.CompleteStreamEvent{Usage: &gateway.Usage{InputTokens: 10, OutputTokens: 5, TotalTokens: 15}}
			close(ch)
			return ch, nil
		},
	}

	conversationID := "convregen000001"
	parentMessageID := "msgregenparent1"
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "regenerate persists an assistant sibling with no new user message",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/regenerate",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"request_id":"req-regen-1",
			"parent_message_id":"msgregenparent1",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"type":"complete"`,
			`"parent_message_id":"msgregenparent1"`,
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
			conversationPublicKey = seedConversationRecord(t, app, conversationID)
			seedMessage(t, app, parentMessageID, conversationID, false)
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
			// The seeded parent plus exactly one new assistant message — no new
			// user message is created when regenerating.
			if len(records) != 2 {
				t.Fatalf("FindRecordsByFilter(messages) len = %d, want %d", len(records), 2)
			}
			var assistant *core.Record
			for _, record := range records {
				if record.Id != parentMessageID {
					assistant = record
				}
			}
			if assistant == nil {
				t.Fatal("no new assistant message was persisted")
			}
			if got := assistant.GetString("parent_message"); got != parentMessageID {
				t.Fatalf("assistant parent_message = %q, want %q", got, parentMessageID)
			}
		},
	}

	scenario.Test(t)
}

func TestConversationRegenerateRejectsForeignParentMessage(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, _ gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			t.Fatal("gateway should not be called when the parent message is foreign")
			return nil, nil
		},
	}

	conversationID := "convregen000002"
	otherConversationID := "convregen000003"
	foreignMessageID := "msgforeignparen"
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "regenerate rejects a parent message from another conversation",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/regenerate",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"request_id":"req-regen-2",
			"parent_message_id":"msgforeignparen",
			"messages":[{"role":"user","content":"hello there"}]
		}`),
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{"Parent message not found"},
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
			conversationPublicKey = seedConversationRecord(t, app, conversationID)
			seedConversationRecord(t, app, otherConversationID)
			// The parent message lives in a different conversation.
			seedMessage(t, app, foreignMessageID, otherConversationID, false)
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

	// Mirror what ConversationsCreate does in production: register the
	// creator as an Admin participant so the completion handler's access
	// gate (participants.Repo.IsActive) accepts requests for this seeded
	// conversation.
	seedParticipant(t, app, conversationID, userRecord.Id, "Admin")

	return *publicKey
}

func TestConversationCompleteRejectsNonParticipant(t *testing.T) {
	t.Parallel()

	conversationID := "convcomp0000003"
	gatewayCalled := false
	gatewayClient := &gateway.MockClient{
		CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
			// Mark the call so we can assert it never happened — the access
			// gate must reject the request before any provider work, both
			// for billing safety and to avoid leaking that the conversation
			// id is real.
			gatewayCalled = true
			return gateway.CompleteResponse{}, nil
		},
	}
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "non-participant cannot complete against another user's conversation",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"snoop"}]
		}`),
		ExpectedStatus: http.StatusNotFound,
		ExpectedContent: []string{
			`"message":"Conversation not found or unable to load."`,
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
			// test1 owns the conversation; test2 (a non-participant) tries
			// to send a completion request against it.
			conversationPublicKey = seedConversationRecord(t, app, conversationID)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if gatewayCalled {
				t.Fatalf("gateway Complete was called: access gate must short-circuit before any provider work")
			}
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
				t.Fatalf("non-participant attempt persisted %d messages, want 0", len(records))
			}
		},
	}

	scenario.Test(t)
}
