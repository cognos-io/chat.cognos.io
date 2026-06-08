package main

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// These tests prove the PocketBase /api/collections/* surface is fully
// locked on the chat collections. The first-party /api/v1/* handlers
// authorise through the participants repo and call the PocketBase app
// directly (bypassing collection rules), so this is the "no direct
// collection-API access" defence layer end-to-end.
//
// We exercise the lock with three realistic users:
//   - "test1": owner / active Admin participant of the test conversation
//   - "test2": Editor participant who has been soft-revoked
//   - "no_data": never added to the conversation
//
// All three must hit the same 403 (or 200-empty for list-by-rule) on
// every endpoint — even the owner. That asymmetry vs. the previous
// "creator-only" rules is intentional: production access goes through
// /api/v1, never /api/collections.

const (
	rulesConversationID  = "convrultest0001"
	rulesConvPubKeyID    = "convpubrtest001"
	rulesConvSecretKeyID = "convsecrtest001"
	rulesMessageID       = "msgrultest00001"
	rulesActiveEditorID  = "xq9ndvc2kbrvrng" // test2
	rulesOwnerID         = "uvi8zmr78j9y5hz" // test1
	rulesOutsiderID      = "j8prcx3dum2l3kc" // no_data
)

func seedRuleScenarioApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app := setupTestApp(t)

	seedOwnedConversation(t, app, rulesConversationID, "test1@example.com")
	seedParticipant(t, app, rulesConversationID, rulesActiveEditorID, "Editor")
	if err := softRevokeParticipant(app, rulesConversationID, rulesActiveEditorID); err != nil {
		t.Fatalf("softRevokeParticipant: %v", err)
	}

	publicKeyCollection, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) = %v", err)
	}
	pkRecord := core.NewRecord(publicKeyCollection)
	pkRecord.Id = rulesConvPubKeyID
	pkRecord.Set("conversation", rulesConversationID)
	pkRecord.Set("public_key", strings.Repeat("A", 43)+"=")
	pkRecord.Set("public_key_signature", strings.Repeat("B", 43)+"=")
	pkRecord.Set("key_version", 1)
	if err := app.Save(pkRecord); err != nil {
		t.Fatalf("Save(public_key) = %v", err)
	}

	secretKeyCollection, err := app.FindCollectionByNameOrId("conversation_secret_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_secret_keys) = %v", err)
	}
	for i, userID := range []string{rulesOwnerID, rulesActiveEditorID} {
		sk := core.NewRecord(secretKeyCollection)
		if i == 0 {
			sk.Id = rulesConvSecretKeyID
		}
		sk.Set("conversation", rulesConversationID)
		sk.Set("user", userID)
		sk.Set("secret_key", strings.Repeat("C", 43)+"=")
		sk.Set("key_version", 1)
		if err := app.Save(sk); err != nil {
			t.Fatalf("Save(secret_key) = %v", err)
		}
	}

	messageCollection, err := app.FindCollectionByNameOrId("messages")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(messages) = %v", err)
	}
	msg := core.NewRecord(messageCollection)
	msg.Id = rulesMessageID
	msg.Set("conversation", rulesConversationID)
	msg.Set("data", base64.StdEncoding.EncodeToString([]byte("ciphertext")))
	if err := app.Save(msg); err != nil {
		t.Fatalf("Save(message) = %v", err)
	}

	return app
}

func softRevokeParticipant(app *tests.TestApp, conversationID, userID string) error {
	record, err := app.FindFirstRecordByFilter(
		"participants",
		"conversation = {:c} && user = {:u}",
		dbx.Params{"c": conversationID, "u": userID},
	)
	if err != nil {
		return err
	}
	record.Set("removed_at", time.Now().UTC())
	return app.Save(record)
}

// runLockedCollectionScenario asserts that hitting the raw collection
// route as a given user returns the expected forbidden/locked status.
// PocketBase returns 403 ("Only admins can perform this action.") when
// the rule is nil — that's the canonical "locked" response we lock in.
func runLockedCollectionScenario(t *testing.T, name, method, url, userEmail string) {
	t.Helper()
	scenario := tests.ApiScenario{
		Name:           name + " as " + userEmail,
		Method:         method,
		URL:            url,
		ExpectedStatus: http.StatusForbidden,
		ExpectedContent: []string{
			`"message":"Only superusers can perform this action."`,
		},
		TestAppFactory: seedRuleScenarioApp,
		BeforeTestFunc: withRecordAuth("users", userEmail),
	}
	scenario.Test(t)
}

// Every authenticated user — including the owner — must be blocked on
// every operation against the chat collections. Production access goes
// through /api/v1/*; the collection routes intentionally reject all
// callers so a future bug can't fall through to a permissive default.

func TestConversationsCollectionRoutesLocked(t *testing.T) {
	t.Parallel()

	users := []string{
		"test1@example.com",   // owner / Admin participant
		"test2@example.com",   // soft-revoked editor
		"no_data@example.com", // outsider
	}

	for _, email := range users {
		runLockedCollectionScenario(t,
			"conversations.list",
			http.MethodGet,
			"/api/collections/conversations/records",
			email)
		runLockedCollectionScenario(t,
			"conversations.view",
			http.MethodGet,
			"/api/collections/conversations/records/"+rulesConversationID,
			email)
		runLockedCollectionScenario(t,
			"conversations.create",
			http.MethodPost,
			"/api/collections/conversations/records",
			email)
		runLockedCollectionScenario(t,
			"conversations.update",
			http.MethodPatch,
			"/api/collections/conversations/records/"+rulesConversationID,
			email)
		runLockedCollectionScenario(t,
			"conversations.delete",
			http.MethodDelete,
			"/api/collections/conversations/records/"+rulesConversationID,
			email)
	}
}

func TestConversationPublicKeysCollectionRoutesLocked(t *testing.T) {
	t.Parallel()

	users := []string{
		"test1@example.com",
		"test2@example.com",
		"no_data@example.com",
	}

	for _, email := range users {
		runLockedCollectionScenario(t,
			"public_keys.list",
			http.MethodGet,
			"/api/collections/conversation_public_keys/records",
			email)
		runLockedCollectionScenario(t,
			"public_keys.view",
			http.MethodGet,
			"/api/collections/conversation_public_keys/records/"+rulesConvPubKeyID,
			email)
		runLockedCollectionScenario(t,
			"public_keys.create",
			http.MethodPost,
			"/api/collections/conversation_public_keys/records",
			email)
		runLockedCollectionScenario(t,
			"public_keys.update",
			http.MethodPatch,
			"/api/collections/conversation_public_keys/records/"+rulesConvPubKeyID,
			email)
		runLockedCollectionScenario(t,
			"public_keys.delete",
			http.MethodDelete,
			"/api/collections/conversation_public_keys/records/"+rulesConvPubKeyID,
			email)
	}
}

func TestConversationSecretKeysCollectionRoutesLocked(t *testing.T) {
	t.Parallel()

	users := []string{
		"test1@example.com",
		"test2@example.com",
		"no_data@example.com",
	}

	for _, email := range users {
		runLockedCollectionScenario(t,
			"secret_keys.list",
			http.MethodGet,
			"/api/collections/conversation_secret_keys/records",
			email)
		runLockedCollectionScenario(t,
			"secret_keys.view",
			http.MethodGet,
			"/api/collections/conversation_secret_keys/records/"+rulesConvSecretKeyID,
			email)
		runLockedCollectionScenario(t,
			"secret_keys.create",
			http.MethodPost,
			"/api/collections/conversation_secret_keys/records",
			email)
	}
}

func TestMessagesCollectionRoutesLocked(t *testing.T) {
	t.Parallel()

	users := []string{
		"test1@example.com",
		"test2@example.com",
		"no_data@example.com",
	}

	for _, email := range users {
		runLockedCollectionScenario(t,
			"messages.list",
			http.MethodGet,
			"/api/collections/messages/records",
			email)
		runLockedCollectionScenario(t,
			"messages.view",
			http.MethodGet,
			"/api/collections/messages/records/"+rulesMessageID,
			email)
		runLockedCollectionScenario(t,
			"messages.create",
			http.MethodPost,
			"/api/collections/messages/records",
			email)
		runLockedCollectionScenario(t,
			"messages.update",
			http.MethodPatch,
			"/api/collections/messages/records/"+rulesMessageID,
			email)
		runLockedCollectionScenario(t,
			"messages.delete",
			http.MethodDelete,
			"/api/collections/messages/records/"+rulesMessageID,
			email)
	}
}

func TestParticipantsCollectionRoutesLocked(t *testing.T) {
	t.Parallel()

	// Even the conversation owner can't reach /api/collections/participants
	// — all participant mutations go through /api/v1/conversations/{id}/
	// participants and rotation goes through /api/v1/conversations/{id}/
	// rotate. This pins the "no leakage of membership via the raw
	// collection API" invariant.
	for _, email := range []string{
		"test1@example.com", "test2@example.com", "no_data@example.com",
	} {
		runLockedCollectionScenario(t,
			"participants.list",
			http.MethodGet,
			"/api/collections/participants/records",
			email)
		runLockedCollectionScenario(t,
			"participants.create",
			http.MethodPost,
			"/api/collections/participants/records",
			email)
	}
}
