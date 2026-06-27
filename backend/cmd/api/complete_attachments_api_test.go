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

// TestConversationCompleteWithAttachment verifies the end-to-end attachment
// completion path: the provider receives the wrapped untrusted context, the
// user message persists only encrypted references (never the plaintext
// context), and a usage row links the library file to the new message.
func TestConversationCompleteWithAttachment(t *testing.T) {
	t.Parallel()

	const docBody = "SECRET_DOC_BODY_should_never_persist"
	var sentUserContent string

	gatewayClient := &gateway.MockClient{
		CompleteStreamFunc: func(_ context.Context, req gateway.CompleteRequest) (<-chan gateway.CompleteStreamEvent, error) {
			sentUserContent = req.Messages[len(req.Messages)-1].Content
			ch := make(chan gateway.CompleteStreamEvent, 2)
			ch <- gateway.CompleteStreamEvent{Delta: "ok"}
			ch <- gateway.CompleteStreamEvent{Usage: &gateway.Usage{InputTokens: 10, OutputTokens: 2, TotalTokens: 12}}
			close(ch)
			return ch, nil
		},
	}

	conversationID := "convcompatt0001"
	attachmentID := "attcompatt00001"
	manifest := base64.StdEncoding.EncodeToString([]byte("sealed-manifest"))
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "completion with attachment wraps context and links the attachment",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"summarise this"}],
			"attachment_ids":["` + attachmentID + `"],
			"attachment_contexts":[{
				"attachment_id":"` + attachmentID + `",
				"display_name":"notes.txt",
				"detected_mime_type":"text/plain",
				"processor_id":"text",
				"text_context":"` + docBody + `"
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
			seedLibraryAttachment(t, app, attachmentID, "test1@example.com", manifest, [][]byte{[]byte("ciphertext")})
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			// The provider must have seen the untrusted wrapper + the doc body +
			// the user's own text, all in the user turn.
			for _, want := range []string{"untrusted user-provided data", docBody, "summarise this"} {
				if !strings.Contains(sentUserContent, want) {
					t.Fatalf("provider user content missing %q\n got: %s", want, sentUserContent)
				}
			}

			// No persisted message may contain the plaintext attachment context.
			messages, err := app.FindRecordsByFilter("messages", "conversation={:c}", "", 10, 0, dbx.Params{"c": conversationID})
			if err != nil {
				t.Fatalf("FindRecordsByFilter(messages) error = %v", err)
			}
			if len(messages) != 2 {
				t.Fatalf("persisted %d messages, want 2", len(messages))
			}
			for _, m := range messages {
				if strings.Contains(m.GetString("data"), docBody) {
					t.Fatalf("message data leaked plaintext attachment context")
				}
			}

			// A usage row now links the library file to the new user message, and
			// the library record's manifest is untouched by referencing it.
			usages, err := app.FindRecordsByFilter(
				"attachment_usages", "attachment={:a}", "", 10, 0,
				dbx.Params{"a": attachmentID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(usages) error = %v", err)
			}
			if len(usages) != 1 {
				t.Fatalf("recorded %d usage rows, want 1", len(usages))
			}
			if usages[0].GetString("conversation") != conversationID {
				t.Fatalf("usage conversation = %q, want %q", usages[0].GetString("conversation"), conversationID)
			}
			rec, err := app.FindRecordById("user_attachments", attachmentID)
			if err != nil {
				t.Fatalf("FindRecordById(attachment) error = %v", err)
			}
			if rec.GetString("data") != manifest {
				t.Fatalf("attachment manifest changed: %q", rec.GetString("data"))
			}
		},
	}
	scenario.Test(t)
}

// TestConversationCompleteRejectsAttachmentOfAnotherUser ensures a caller cannot
// reference a library file owned by a different user.
func TestConversationCompleteRejectsAttachmentOfAnotherUser(t *testing.T) {
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

	targetConversationID := "convcompatt0002"
	foreignAttachmentID := "attforeign00001"
	manifest := base64.StdEncoding.EncodeToString([]byte("sealed"))
	var conversationPublicKey [32]byte

	scenario := tests.ApiScenario{
		Name:   "completion rejects an attachment id owned by another user",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + targetConversationID + "/complete",
		Body: strings.NewReader(`{
			"model_id":"llama-3-3-infomaniak",
			"persona_id":"cognos:simple-assistant",
			"system_prompt":"test persona prompt",
			"messages":[{"role":"user","content":"hi"}],
			"attachment_ids":["` + foreignAttachmentID + `"]
		}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"Invalid attachment reference"},
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
			conversationPublicKey = seedConversationRecord(t, app, targetConversationID)
			// Owned by a DIFFERENT user — test1 must not be able to reference it.
			seedLibraryAttachment(t, app, foreignAttachmentID, "test2@example.com", manifest, [][]byte{[]byte("ct")})
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if gatewayCalled {
				t.Fatalf("gateway was called despite an invalid attachment reference")
			}
			messages, _ := app.FindRecordsByFilter("messages", "conversation={:c}", "", 10, 0, dbx.Params{"c": targetConversationID})
			if len(messages) != 0 {
				t.Fatalf("persisted %d messages, want 0", len(messages))
			}
		},
	}
	scenario.Test(t)
}
