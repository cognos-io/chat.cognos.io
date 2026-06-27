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

// enableModelVision flips supports_vision on a seeded model so the completion
// handler accepts image attachments for it. The catalogue cache is cold in
// tests (an injected gateway skips the startup warm), so this is read fresh.
func enableModelVision(t testing.TB, app *tests.TestApp, modelID string) {
	t.Helper()
	rec, err := app.FindFirstRecordByFilter(
		"ai_models", "model_id={:m}", dbx.Params{"m": modelID},
	)
	if err != nil {
		t.Fatalf("find model %q: %v", modelID, err)
	}
	rec.Set("supports_vision", true)
	if err := app.Save(rec); err != nil {
		t.Fatalf("enable vision on %q: %v", modelID, err)
	}
}

func TestConversationCompleteSendsImageToVisionModel(t *testing.T) {
	t.Parallel()

	var sentImages []gateway.MessageImage
	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, req gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			if len(req.Messages) > 0 {
				sentImages = req.Messages[len(req.Messages)-1].Images
			}
			ch := make(chan gateway.CompleteStreamEvent, 2)
			ch <- gateway.CompleteStreamEvent{Delta: "a fox"}
			ch <- gateway.CompleteStreamEvent{Usage: &gateway.Usage{InputTokens: 20, OutputTokens: 3, TotalTokens: 23}}
			close(ch)
			return ch, nil
		},
	}

	conversationID := "convvision00001"
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "image attachment is sent to a vision-capable model",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"what is in this image?"}],
			"attachment_contexts":[{
				"attachment_id":"",
				"display_name":"fox.png",
				"detected_mime_type":"image/png",
				"processor_id":"image",
				"image_base64":"QUJDREVG",
				"image_mime_type":"image/png"
			}]
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
			withRecordAuth("users", "test1@example.com")(t, app, e)
			conversationPublicKey = seedConversationRecord(t, app, conversationID)
			enableModelVision(t, app, "llama-3-3-infomaniak")
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if len(sentImages) != 1 {
				t.Fatalf("provider received %d images, want 1", len(sentImages))
			}
			if sentImages[0].Base64 != "QUJDREVG" || sentImages[0].MimeType != "image/png" {
				t.Fatalf("provider image = %+v, want base64 QUJDREVG image/png", sentImages[0])
			}
		},
	}
	scenario.Test(t)
}

func TestConversationCompleteRejectsImageForNonVisionModel(t *testing.T) {
	t.Parallel()

	gatewayCalled := false
	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(context.Context, gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			gatewayCalled = true
			ch := make(chan gateway.CompleteStreamEvent)
			close(ch)
			return ch, nil
		},
	}

	conversationID := "convvision00002"
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "image attachment is rejected for a non-vision model",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"what is in this image?"}],
			"attachment_contexts":[{
				"attachment_id":"",
				"display_name":"fox.png",
				"detected_mime_type":"image/png",
				"processor_id":"image",
				"image_base64":"QUJDREVG"
			}]
		}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"can't read images"},
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
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, _ *http.Response) {
			if gatewayCalled {
				t.Fatalf("gateway was called despite a non-vision model")
			}
		},
	}
	scenario.Test(t)
}
