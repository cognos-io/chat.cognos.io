package main

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/gateway"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// paygStateRepo returns a PayG billing state for any user. PayG never blocks for
// funds, so the affordability gate always passes and the completed request is
// recorded through the real ledger repo — letting these tests assert the
// persisted balance_transactions row without depending on a model's price.
func paygStateRepo() stubBillingStateRepo {
	return stubBillingStateRepo{
		stateForUser: func(string) (billing.State, error) {
			return billing.State{PlanType: billing.PlanTypePayG}, nil
		},
	}
}

// singleUsageRow returns the sole usage row in balance_transactions, failing if
// there is not exactly one. It is how these tests prove a temporary request was
// billed exactly once through the real ledger.
func singleUsageRow(t testing.TB, app *tests.TestApp) *core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter(
		"balance_transactions",
		"type = {:type}",
		"",
		10,
		0,
		dbx.Params{"type": billing.UsageTransactionType},
	)
	if err != nil {
		t.Fatalf("FindRecordsByFilter(balance_transactions) error = %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("balance_transactions usage rows = %d, want 1", len(rows))
	}
	return rows[0]
}

func TestTemporaryImageRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "stateless image generation requires record auth",
		Method:          http.MethodPost,
		URL:             "/api/v1/images",
		Body:            strings.NewReader(`{"model_id":"gemini-2-5-flash-image","prompt":"a fox"}`),
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

// TestTemporaryImageGenerationRecordsBillingTransaction is the core guarantee:
// a temporary-chat image generation returns the image inline, persists NO
// message, and still records exactly one image billing row.
func TestTemporaryImageGenerationRecordsBillingTransaction(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		GenerateImageFunc: func(_ context.Context, _ gateway.ImageRequest) (gateway.ImageResponse, error) {
			return gateway.ImageResponse{
				Images: []gateway.GeneratedImage{{Bytes: fakeImageBytes, MimeType: "image/png"}},
				Usage:  gateway.Usage{InputTokens: 7, OutputTokens: 1303, TotalTokens: 1310},
			}, nil
		},
	}

	var initialMessages int64

	scenario := tests.ApiScenario{
		Name:   "temporary image generation returns inline bytes and bills once",
		Method: http.MethodPost,
		URL:    "/api/v1/images",
		Body: strings.NewReader(`{
			"model_id":"gemini-2-5-flash-image",
			"prompt":"a watercolour fox reading a book",
			"request_id":"img-temp-1"
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"request_id":"img-temp-1"`,
			`"kind":"inline_image"`,
			`"mime_type":"image/png"`,
			`"data_base64":"`,
		},
		// The inline path returns no stored-file handles.
		NotExpectedContent: []string{`"file_name"`, `"sealed_key"`, `"user_message_id"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:    gatewayClient,
				BillingService:   billing.NewService(),
				BillingStateRepo: paygStateRepo(),
			})
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			withRecordAuth("users", "test1@example.com")(t, app, e)
			count, err := app.CountRecords("messages")
			if err != nil {
				t.Fatalf("CountRecords(messages) error = %v", err)
			}
			initialMessages = count
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			// Nothing is persisted for a temporary chat.
			count, err := app.CountRecords("messages")
			if err != nil {
				t.Fatalf("CountRecords(messages) error = %v", err)
			}
			if count != initialMessages {
				t.Fatalf("CountRecords(messages) = %d, want %d (temporary chat persists nothing)", count, initialMessages)
			}

			row := singleUsageRow(t, app)
			if got := row.GetString("operation_type"); got != string(billing.OperationTypeImageGeneration) {
				t.Errorf("balance_transactions.operation_type = %q, want %q", got, billing.OperationTypeImageGeneration)
			}
			if got := row.GetInt("generated_image_count"); got != 1 {
				t.Errorf("balance_transactions.generated_image_count = %d, want 1", got)
			}
			if got := row.GetString("model_id"); got != "gemini-2-5-flash-image" {
				t.Errorf("balance_transactions.model_id = %q, want gemini-2-5-flash-image", got)
			}
			if got := row.GetInt("user_cost_microrappen"); got <= 0 {
				t.Errorf("balance_transactions.user_cost_microrappen = %d, want > 0", got)
			}
		},
	}

	scenario.Test(t)
}

// TestTemporaryImageTextFallbackBillsAsText covers an image model that answers
// with words instead of an image: the reply is returned inline and billed as a
// text turn, with nothing persisted.
func TestTemporaryImageTextFallbackBillsAsText(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		GenerateImageFunc: func(_ context.Context, _ gateway.ImageRequest) (gateway.ImageResponse, error) {
			return gateway.ImageResponse{
				Text:  "I can't create that image, but here's a description instead.",
				Usage: gateway.Usage{InputTokens: 9, OutputTokens: 20, TotalTokens: 29},
			}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "temporary image text fallback bills as text",
		Method: http.MethodPost,
		URL:    "/api/v1/images",
		Body: strings.NewReader(`{
			"model_id":"gemini-2-5-flash-image",
			"prompt":"draw something forbidden",
			"request_id":"img-temp-2"
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"request_id":"img-temp-2"`,
			`"content":"I can't create that image`,
		},
		NotExpectedContent: []string{`"attachment"`, `"data_base64"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:    gatewayClient,
				BillingService:   billing.NewService(),
				BillingStateRepo: paygStateRepo(),
			})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			count, err := app.CountRecords("messages")
			if err != nil {
				t.Fatalf("CountRecords(messages) error = %v", err)
			}
			if count != 0 {
				t.Fatalf("CountRecords(messages) = %d, want 0", count)
			}
			row := singleUsageRow(t, app)
			if got := row.GetString("operation_type"); got != string(billing.OperationTypeText) {
				t.Errorf("balance_transactions.operation_type = %q, want %q", got, billing.OperationTypeText)
			}
			if got := row.GetInt("generated_image_count"); got != 0 {
				t.Errorf("balance_transactions.generated_image_count = %d, want 0", got)
			}
		},
	}

	scenario.Test(t)
}

// TestTemporaryImageGenerationBillingGateBlocks proves the affordability gate
// runs on the stateless path: an inactive account is refused with 402 before the
// provider is called, and nothing is billed.
func TestTemporaryImageGenerationBillingGateBlocks(t *testing.T) {
	t.Parallel()

	ledgerRepo := &recordingLedgerRepo{}
	gatewayClient := &gateway.MockClient{
		GenerateImageFunc: func(context.Context, gateway.ImageRequest) (gateway.ImageResponse, error) {
			t.Fatal("GenerateImage() must not be called when billing blocks the request")
			return gateway.ImageResponse{}, nil
		},
	}

	scenario := tests.ApiScenario{
		Name:   "temporary image generation is blocked with 402 when billing denies access",
		Method: http.MethodPost,
		URL:    "/api/v1/images",
		Body: strings.NewReader(`{
			"model_id":"gemini-2-5-flash-image",
			"prompt":"a fox"
		}`),
		ExpectedStatus:  http.StatusPaymentRequired,
		ExpectedContent: []string{`"error":"INACTIVE"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			return setupTestAppWithHookParams(t, appHookParams{
				GatewayClient:     gatewayClient,
				BillingService:    billing.NewService(),
				BillingLedgerRepo: ledgerRepo,
				BillingStateRepo: stubBillingStateRepo{
					stateForUser: func(string) (billing.State, error) {
						return billing.State{PlanType: billing.PlanTypeInactive}, nil
					},
				},
			})
		},
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if len(ledgerRepo.records) != 0 {
				t.Fatalf("RecordUsage() count = %d, want 0", len(ledgerRepo.records))
			}
		},
	}

	scenario.Test(t)
}

// TestTemporaryResourcesRecordBillingParity is the lock-in: every temporary-chat
// resource — text, web search, image generation, and an image model's text
// fallback — writes exactly one usage row with the expected discriminators. If a
// future change lets any temporary path skip billing, one of these fails.
func TestTemporaryResourcesRecordBillingParity(t *testing.T) {
	t.Parallel()

	providerCostUSD := 0.42

	type parityCase struct {
		name          string
		url           string
		body          string
		client        *gateway.MockClient
		wantOperation billing.OperationType
		wantSearch    int
		wantImages    int
	}

	cases := []parityCase{
		{
			name: "temporary text completion",
			url:  "/api/v1/completions",
			body: `{
				"model_id":"llama-3-3-infomaniak",
				"persona_id":"cognos:simple-assistant",
				"system_prompt":"test persona prompt",
				"messages":[{"role":"user","content":"hello there"}]
			}`,
			client: &gateway.MockClient{
				CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
					return gateway.CompleteResponse{
						Message: gateway.Message{Role: "assistant", Content: "text reply"},
						Usage:   gateway.Usage{InputTokens: 8, OutputTokens: 4, TotalTokens: 12, ProviderCostUSD: &providerCostUSD},
					}, nil
				},
			},
			wantOperation: billing.OperationTypeText,
		},
		{
			name: "temporary web search completion",
			url:  "/api/v1/completions",
			body: `{
				"model_id":"llama-3-3-infomaniak",
				"persona_id":"cognos:simple-assistant",
				"system_prompt":"test persona prompt",
				"web_search":true,
				"messages":[{"role":"user","content":"what happened today"}]
			}`,
			client: &gateway.MockClient{
				CompleteFunc: func(context.Context, gateway.CompleteRequest) (gateway.CompleteResponse, error) {
					return gateway.CompleteResponse{
						Message: gateway.Message{Role: "assistant", Content: "searched reply"},
						Usage:   gateway.Usage{InputTokens: 8, OutputTokens: 4, TotalTokens: 12, SearchCount: 1, ProviderCostUSD: &providerCostUSD},
					}, nil
				},
			},
			wantOperation: billing.OperationTypeText,
			wantSearch:    1,
		},
		{
			name: "temporary image generation",
			url:  "/api/v1/images",
			body: `{
				"model_id":"gemini-2-5-flash-image",
				"prompt":"a watercolour fox"
			}`,
			client: &gateway.MockClient{
				GenerateImageFunc: func(context.Context, gateway.ImageRequest) (gateway.ImageResponse, error) {
					return gateway.ImageResponse{
						Images: []gateway.GeneratedImage{{Bytes: fakeImageBytes, MimeType: "image/png"}},
						Usage:  gateway.Usage{InputTokens: 7, OutputTokens: 1303, TotalTokens: 1310, ProviderCostUSD: &providerCostUSD},
					}, nil
				},
			},
			wantOperation: billing.OperationTypeImageGeneration,
			wantImages:    1,
		},
		{
			name: "temporary image text fallback",
			url:  "/api/v1/images",
			body: `{
				"model_id":"gemini-2-5-flash-image",
				"prompt":"draw something forbidden"
			}`,
			client: &gateway.MockClient{
				GenerateImageFunc: func(context.Context, gateway.ImageRequest) (gateway.ImageResponse, error) {
					return gateway.ImageResponse{
						Text:  "here is a description instead",
						Usage: gateway.Usage{InputTokens: 9, OutputTokens: 20, TotalTokens: 29, ProviderCostUSD: &providerCostUSD},
					}, nil
				},
			},
			wantOperation: billing.OperationTypeText,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			scenario := tests.ApiScenario{
				Name:            tc.name,
				Method:          http.MethodPost,
				URL:             tc.url,
				Body:            strings.NewReader(tc.body),
				ExpectedStatus:  http.StatusOK,
				ExpectedContent: []string{`"usage"`},
				TestAppFactory: func(t testing.TB) *tests.TestApp {
					return setupTestAppWithHookParams(t, appHookParams{
						GatewayClient:    tc.client,
						BillingService:   billing.NewService(),
						BillingStateRepo: paygStateRepo(),
					})
				},
				BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
				AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
					// Temporary chats persist nothing regardless of resource type.
					count, err := app.CountRecords("messages")
					if err != nil {
						t.Fatalf("CountRecords(messages) error = %v", err)
					}
					if count != 0 {
						t.Fatalf("CountRecords(messages) = %d, want 0", count)
					}

					row := singleUsageRow(t, app)
					if got := row.GetString("operation_type"); got != string(tc.wantOperation) {
						t.Errorf("operation_type = %q, want %q", got, tc.wantOperation)
					}
					if got := row.GetInt("search_count"); got != tc.wantSearch {
						t.Errorf("search_count = %d, want %d", got, tc.wantSearch)
					}
					if got := row.GetInt("generated_image_count"); got != tc.wantImages {
						t.Errorf("generated_image_count = %d, want %d", got, tc.wantImages)
					}
					if got := row.GetInt("user_cost_microrappen"); got <= 0 {
						t.Errorf("user_cost_microrappen = %d, want > 0", got)
					}
				},
			}

			scenario.Test(t)
		})
	}
}
