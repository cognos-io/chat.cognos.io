package main

import (
	"context"
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
)

// fakeImageBytes is the "decoded image" the mock gateway returns. The test
// asserts these plaintext bytes never reach the database or object storage.
var fakeImageBytes = []byte("\x89PNG\r\n\x1a\n not a real image but distinctive")

func TestConversationImageRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "image generation requires record auth",
		Method:          http.MethodPost,
		URL:             "/api/v1/conversations/convimg00000001/image",
		Body:            strings.NewReader(`{"model_id":"gemini-2-5-flash-image","prompt":"a fox"}`),
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

func TestConversationImageRejectsNonImageModelBeforeGateway(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		GenerateImageFunc: func(context.Context, gateway.ImageRequest) (gateway.ImageResponse, error) {
			t.Fatal("GenerateImage() must not be called for a text-only model")
			return gateway.ImageResponse{}, nil
		},
	}

	conversationID := "convimgreject01"
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:           "image generation rejects a text-only model before the gateway call",
		Method:         http.MethodPost,
		URL:            "/api/v1/conversations/" + conversationID + "/image",
		Body:           strings.NewReader(`{"model_id":"llama-3-3-infomaniak","prompt":"a fox"}`),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			"does not support image generation",
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
	}

	scenario.Test(t)
}

func TestConversationImageGenerationPersistsEncryptedAttachment(t *testing.T) {
	t.Parallel()

	gatewayClient := &gateway.MockClient{
		GenerateImageFunc: func(_ context.Context, req gateway.ImageRequest) (gateway.ImageResponse, error) {
			if req.Transport != gateway.ImageTransportChatCompletions {
				t.Fatalf("GenerateImage() Transport = %q, want chat_completions", req.Transport)
			}
			if req.ProviderModelID != "vertex/gemini-2.5-flash-image@europe-central2" {
				t.Fatalf("GenerateImage() ProviderModelID = %q", req.ProviderModelID)
			}
			if req.Prompt != "a watercolour fox reading a book" {
				t.Fatalf("GenerateImage() Prompt = %q", req.Prompt)
			}
			return gateway.ImageResponse{
				Images: []gateway.GeneratedImage{{Bytes: fakeImageBytes, MimeType: "image/png"}},
				Usage:  gateway.Usage{InputTokens: 7, OutputTokens: 1303, TotalTokens: 1310},
			}, nil
		},
	}

	conversationID := "convimgok000001"
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "image generation persists an encrypted attachment",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/image",
		Body: strings.NewReader(`{
			"model_id":"gemini-2-5-flash-image",
			"prompt":"a watercolour fox reading a book",
			"request_id":"img-1"
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"request_id":"img-1"`,
			`"kind":"generated_image"`,
			`"mime_type":"image/png"`,
			`"file_name":"`,
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
				t.Fatalf("persisted %d messages, want 2 (prompt + assistant image)", len(records))
			}

			var assistant *core.Record
			for _, record := range records {
				// Neither message's encrypted data may leak the prompt.
				if strings.Contains(record.GetString("data"), "watercolour fox") {
					t.Fatalf("message data leaked the prompt: %q", record.GetString("data"))
				}
				if record.GetString("attachment") != "" {
					assistant = record
				}
			}
			if assistant == nil {
				t.Fatal("no message carries an attachment")
			}

			filename := assistant.GetString("attachment")
			if !strings.HasSuffix(filename, ".enc") {
				t.Errorf("attachment filename = %q, want a .enc file", filename)
			}

			// The stored attachment must be ciphertext, never the plaintext image.
			fsys, err := app.NewFilesystem()
			if err != nil {
				t.Fatalf("NewFilesystem() error = %v", err)
			}
			defer func() { _ = fsys.Close() }()

			reader, err := fsys.GetReader(assistant.BaseFilesPath() + "/" + filename)
			if err != nil {
				t.Fatalf("GetReader(attachment) error = %v", err)
			}
			defer func() { _ = reader.Close() }()
			stored, err := io.ReadAll(reader)
			if err != nil {
				t.Fatalf("read attachment error = %v", err)
			}
			if len(stored) == 0 {
				t.Fatal("stored attachment is empty")
			}
			if strings.Contains(string(stored), string(fakeImageBytes)) {
				t.Fatal("stored attachment contains the plaintext image bytes")
			}
		},
	}

	scenario.Test(t)
}
