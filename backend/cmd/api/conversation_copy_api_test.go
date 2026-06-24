package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// These integration tests cover the conversation-copy guarantees that the
// browser-style API e2e suite can't reach efficiently: the fail-closed gates
// (project / attachment / oversized sources) and the all-or-nothing rollback.
// The crypto/graph happy path is proven end-to-end in
// e2e/tests/conversation-copy-api.spec.ts.

const copyValidCiphertext = "Y2lwaGVydGV4dA==" // base64("ciphertext")

// copyValidKey is base64 of 32 zero bytes (44 chars). The key collections
// enforce a 32-char minimum on public_key / signature / wrapped-secret fields,
// so placeholder key material must clear that bar.
const copyValidKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

// copyBody marshals a copy request body. Most fail-closed paths reject before
// the message bundle is read, so the messages slice is often empty.
func copyBody(t testing.TB, conversation map[string]any, messages []map[string]any) *bytes.Reader {
	t.Helper()
	payload := map[string]any{"conversation": conversation, "messages": messages}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal copy body: %v", err)
	}
	return bytes.NewReader(raw)
}

func validCopyConversationInput(id string) map[string]any {
	return map[string]any{
		"id":                   id,
		"data":                 copyValidKey,
		"public_key":           copyValidKey,
		"public_key_signature": copyValidKey,
		"wrapped_secret_key":   copyValidKey,
		"expiry_duration":      "",
	}
}

// assertConversationAbsent fails if a conversation row exists — the "wrote
// nothing" half of every rejection test.
func assertConversationAbsent(t testing.TB, app *tests.TestApp, conversationID string) {
	t.Helper()
	if _, err := app.FindRecordById("conversations", conversationID); err == nil {
		t.Fatalf("conversation %q exists, want absent (no partial write)", conversationID)
	}
}

func TestConversationCopyRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "copy route requires record auth",
		Method:         http.MethodPost,
		URL:            "/api/v1/conversations/srccopyconv0001/copies",
		Body:           copyBody(t, validCopyConversationInput("dupcopyconv0001"), nil),
		ExpectedStatus: http.StatusUnauthorized,
		ExpectedContent: []string{
			`"message":"The request requires valid record authorization token."`,
		},
		TestAppFactory: setupTestApp,
	}

	scenario.Test(t)
}

func TestConversationCopyNonParticipantReturnsNotFound(t *testing.T) {
	t.Parallel()

	const sourceID = "srccopyconv0001"
	const dupID = "dupcopyconv0001"

	scenario := tests.ApiScenario{
		Name:            "outsider cannot duplicate another user's conversation",
		Method:          http.MethodPost,
		URL:             "/api/v1/conversations/" + sourceID + "/copies",
		Body:            copyBody(t, validCopyConversationInput(dupID), nil),
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"Conversation not found."`},
		TestAppFactory:  setupTestApp,
		// Authenticate as test2 but seed the conversation owned by test1.
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedConversationRecord(t, app, sourceID)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			assertConversationAbsent(t, app, dupID)
		},
	}

	scenario.Test(t)
}

func TestConversationCopyProjectSourceFailsClosed(t *testing.T) {
	t.Parallel()

	const projectID = "copyprojowner01"
	const sourceID = "srccopyproj0001"
	const dupID = "dupcopyconv0001"

	scenario := tests.ApiScenario{
		Name:           "project conversations cannot be duplicated in v1",
		Method:         http.MethodPost,
		URL:            "/api/v1/conversations/" + sourceID + "/copies",
		Body:           copyBody(t, validCopyConversationInput(dupID), nil),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			"Project conversations cannot be duplicated yet",
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			// test1 owns the project, so it can READ the project conversation —
			// the guard must still refuse to duplicate it.
			seedOwnedProject(t, app, projectID, "test1@example.com")
			seedProjectConversation(t, app, projectID, sourceID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			assertConversationAbsent(t, app, dupID)
		},
	}

	scenario.Test(t)
}

func TestConversationCopyAttachmentFailsClosed(t *testing.T) {
	t.Parallel()

	const sourceID = "srccopyconv0001"
	const dupID = "dupcopyconv0001"

	scenario := tests.ApiScenario{
		Name:   "conversations with attachments cannot be duplicated in v1",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + sourceID + "/copies",
		Body: copyBody(t, validCopyConversationInput(dupID), []map[string]any{
			{"id": "dupcopymsg00001", "source_id": "srccopymsg00001", "data": copyValidCiphertext},
		}),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			"Conversations with attachments cannot be duplicated yet",
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedConversationRecord(t, app, sourceID)
			seedMessageWithAttachment(t, app, "srccopymsg00001", sourceID)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			assertConversationAbsent(t, app, dupID)
		},
	}

	scenario.Test(t)
}

func TestConversationCopyOversizedFailsClosed(t *testing.T) {
	t.Parallel()

	const sourceID = "srccopyconv0001"
	const dupID = "dupcopyconv0001"

	scenario := tests.ApiScenario{
		Name:           "conversations over the message cap cannot be duplicated",
		Method:         http.MethodPost,
		URL:            "/api/v1/conversations/" + sourceID + "/copies",
		Body:           copyBody(t, validCopyConversationInput(dupID), nil),
		ExpectedStatus: http.StatusBadRequest,
		ExpectedContent: []string{
			"Conversation is too large to duplicate",
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedConversationRecord(t, app, sourceID)
			// One past the cap (500).
			seedManyMessages(t, app, sourceID, 501)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			assertConversationAbsent(t, app, dupID)
		},
	}

	scenario.Test(t)
}

func TestConversationCopyRollsBackOnMessageFailure(t *testing.T) {
	t.Parallel()

	const sourceID = "srccopyconv0001"
	const dupID = "dupcopyconv0001"

	scenario := tests.ApiScenario{
		Name:   "a mid-transaction message failure leaves no duplicate artefacts",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + sourceID + "/copies",
		// The bundle is graph-valid (one message matching the one source row)
		// but the message ciphertext is not base64, so the message Save fails
		// AFTER the conversation/keys/participant rows are written in the same
		// transaction. The whole thing must roll back.
		Body: copyBody(t, validCopyConversationInput(dupID), []map[string]any{
			{"id": "dupcopymsg00001", "source_id": "srccopymsg00001", "data": "!!! not base64 !!!"},
		}),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{"Failed to duplicate conversation"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedConversationRecord(t, app, sourceID)
			seedMessage(t, app, "srccopymsg00001", sourceID, false)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			// Nothing — not the conversation, nor any of its key/participant/
			// message rows — may survive a rolled-back duplicate.
			assertConversationAbsent(t, app, dupID)
			assertNoRowsForConversation(t, app, "conversation_public_keys", dupID)
			assertNoRowsForConversation(t, app, "conversation_secret_keys", dupID)
			assertNoRowsForConversation(t, app, "participants", dupID)
			assertNoRowsForConversation(t, app, "messages", dupID)
		},
	}

	scenario.Test(t)
}

func TestConversationCopyConflictingConversationIDReturns409(t *testing.T) {
	t.Parallel()

	const sourceID = "srccopyconv0001"
	const occupantID = "occupantconv001"

	scenario := tests.ApiScenario{
		Name:   "a duplicate conversation id that already exists is a 409",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + sourceID + "/copies",
		Body:   copyBody(t, validCopyConversationInput(occupantID), nil),
		// Source has no messages, so an empty bundle is graph-valid; the id
		// conflict is the only failure.
		ExpectedStatus:  http.StatusConflict,
		ExpectedContent: []string{"Duplicate conversation id already exists"},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedConversationRecord(t, app, sourceID)
			seedConversationRecord(t, app, occupantID)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

// seedMessageWithAttachment seeds a message carrying a (dummy) encrypted
// attachment file, so the attachment fail-closed gate has something to detect.
func seedMessageWithAttachment(t testing.TB, app *tests.TestApp, messageID, conversationID string) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("messages")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(messages) error = %v", err)
	}
	file, err := filesystem.NewFileFromBytes([]byte("encrypted-bytes"), "image.enc")
	if err != nil {
		t.Fatalf("NewFileFromBytes error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Id = messageID
	record.Set("conversation", conversationID)
	record.Set("data", copyValidCiphertext)
	record.Set("attachment", file)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(message with attachment) error = %v", err)
	}
}

// seedManyMessages bulk-seeds n linear messages to exercise the size cap.
func seedManyMessages(t testing.TB, app *tests.TestApp, conversationID string, n int) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("messages")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(messages) error = %v", err)
	}
	for i := 0; i < n; i++ {
		record := core.NewRecord(collection)
		record.Set("conversation", conversationID)
		record.Set("data", copyValidCiphertext)
		if err := app.Save(record); err != nil {
			t.Fatalf("Save(bulk message %d) error = %v", i, err)
		}
	}
}

func assertNoRowsForConversation(t testing.TB, app *tests.TestApp, collection, conversationID string) {
	t.Helper()
	records, err := app.FindAllRecords(collection, dbx.HashExp{"conversation": conversationID})
	if err != nil {
		t.Fatalf("FindAllRecords(%s) error = %v", collection, err)
	}
	if len(records) != 0 {
		t.Fatalf("%s has %d rows for %q, want 0", collection, len(records), conversationID)
	}
}
