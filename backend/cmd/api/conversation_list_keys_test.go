package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// listConversationEntry mirrors the embedded key fields the conversation list
// now returns so tests can assert on them without coupling to the handler's
// private response type.
type listConversationEntry struct {
	ID                 string `json:"id"`
	KeyVersion         int    `json:"key_version"`
	PublicKey          string `json:"public_key"`
	PublicKeySignature string `json:"public_key_signature"`
	WrappedSecretKey   string `json:"wrapped_secret_key"`
}

func decodeConversationList(t testing.TB, res *http.Response) []listConversationEntry {
	t.Helper()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("ReadAll(response.Body) error = %v", err)
	}
	var payload []listConversationEntry
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("json.Unmarshal(ConversationsList) error = %v; body = %s", err, string(body))
	}
	return payload
}

func conversationListEntry(t testing.TB, entries []listConversationEntry, id string) listConversationEntry {
	t.Helper()
	for _, entry := range entries {
		if entry.ID == id {
			return entry
		}
	}
	t.Fatalf("conversation %q not found in list response", id)
	return listConversationEntry{}
}

// seedConversationKeyMaterial inserts a public-key row and a per-user wrapped
// secret-key row at a specific generation. Unlike the fixed-id helpers in
// secure_records_api_test.go, this lets a single test seed several
// conversations / users / generations at once.
func seedConversationKeyMaterial(
	t testing.TB,
	app *tests.TestApp,
	conversationID, userID string,
	keyVersion int,
	publicKey, publicKeySignature, wrappedSecretKey string,
) {
	t.Helper()

	pubCollection, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) error = %v", err)
	}
	// Insert the public-key row once per (conversation, version); a shared
	// conversation reuses the same public key across participants.
	existingPub, _ := app.FindFirstRecordByFilter(
		"conversation_public_keys",
		"conversation = {:c} && key_version = {:v}",
		map[string]any{"c": conversationID, "v": keyVersion},
	)
	if existingPub == nil {
		pub := core.NewRecord(pubCollection)
		pub.Set("conversation", conversationID)
		pub.Set("public_key", publicKey)
		pub.Set("public_key_signature", publicKeySignature)
		pub.Set("key_version", keyVersion)
		if err := app.Save(pub); err != nil {
			t.Fatalf("Save(conversation_public_keys) error = %v", err)
		}
	}

	secCollection, err := app.FindCollectionByNameOrId("conversation_secret_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_secret_keys) error = %v", err)
	}
	sec := core.NewRecord(secCollection)
	sec.Set("conversation", conversationID)
	sec.Set("user", userID)
	sec.Set("secret_key", wrappedSecretKey)
	sec.Set("key_version", keyVersion)
	if err := app.Save(sec); err != nil {
		t.Fatalf("Save(conversation_secret_keys) error = %v", err)
	}
}

func userID(t testing.TB, app *tests.TestApp, email string) string {
	t.Helper()
	record, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", email, err)
	}
	return record.Id
}

// The list embeds the current-generation public key + signature and the
// requesting user's wrapped secret key so the client decrypts without a
// per-conversation key round-trip.
func TestConversationListEmbedsCurrentKeyMaterial(t *testing.T) {
	t.Parallel()

	const (
		conversationID = "embedconv000001"
		pubKey         = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
		pubKeySig      = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
		wrappedSecret  = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC="
	)

	scenario := tests.ApiScenario{
		Name:           "conversation list embeds current key material",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"public_key":"` + pubKey + `"`,
			`"public_key_signature":"` + pubKeySig + `"`,
			`"wrapped_secret_key":"` + wrappedSecret + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedConversationKeyMaterial(
				t, app, conversationID, userID(t, app, "test1@example.com"),
				1, pubKey, pubKeySig, wrappedSecret,
			)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

// Cross-user denial: a second participant's wrapped secret key must never
// appear in the first user's list, even when both have a wrapped key row for
// the same conversation generation.
func TestConversationListEmbedsOnlyRequestingUsersWrappedKey(t *testing.T) {
	t.Parallel()

	const (
		conversationID = "embedshared0001"
		pubKey         = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
		pubKeySig      = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
		user1Wrapped   = "MQ11c2VyMXdyYXBwZWRzZWNyZXRrZXl2YWx1ZTAwMDA="
		user2Wrapped   = "Mg22c2VyMndyYXBwZWRzZWNyZXRrZXl2YWx1ZTAwMDA="
	)

	scenario := tests.ApiScenario{
		Name:            "conversation list embeds only the requesting user's wrapped key",
		Method:          http.MethodGet,
		URL:             "/api/v1/conversations",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"wrapped_secret_key":"` + user1Wrapped + `"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedParticipant(t, app, conversationID, userID(t, app, "test2@example.com"), "Editor")
			seedConversationKeyMaterial(
				t, app, conversationID, userID(t, app, "test1@example.com"),
				1, pubKey, pubKeySig, user1Wrapped,
			)
			seedConversationKeyMaterial(
				t, app, conversationID, userID(t, app, "test2@example.com"),
				1, pubKey, pubKeySig, user2Wrapped,
			)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(response.Body) error = %v", err)
			}
			if strings.Contains(string(body), user2Wrapped) {
				t.Fatalf("response leaked another participant's wrapped key: %s", string(body))
			}
		},
	}

	scenario.Test(t)
}

// Only the conversation's CURRENT generation key material is embedded; after a
// rotation the previous generation's wrapped key never resurfaces in the list.
func TestConversationListEmbedsOnlyCurrentKeyVersion(t *testing.T) {
	t.Parallel()

	const (
		conversationID = "embedrotate0001"
		pubKeyV1       = "djEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
		pubKeyV2       = "djIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
		wrappedV1      = "djF3cmFwcGVkc2VjcmV0a2V5dmFsdWUwMDAwMDAwMDA="
		wrappedV2      = "djJ3cmFwcGVkc2VjcmV0a2V5dmFsdWUwMDAwMDAwMDA="
	)

	scenario := tests.ApiScenario{
		Name:            "conversation list embeds only current generation key material",
		Method:          http.MethodGet,
		URL:             "/api/v1/conversations",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"wrapped_secret_key":"` + wrappedV2 + `"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			uid := userID(t, app, "test1@example.com")
			seedConversationKeyMaterial(t, app, conversationID, uid, 1, pubKeyV1, pubKeyV1, wrappedV1)
			seedConversationKeyMaterial(t, app, conversationID, uid, 2, pubKeyV2, pubKeyV2, wrappedV2)
			// Bump the conversation to generation 2.
			record, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			record.Set("key_version", 2)
			if err := app.Save(record); err != nil {
				t.Fatalf("Save(conversation key_version=2) error = %v", err)
			}
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(response.Body) error = %v", err)
			}
			if strings.Contains(string(body), wrappedV1) {
				t.Fatalf("response embedded stale generation key material: %s", string(body))
			}
		},
	}

	scenario.Test(t)
}

// The wrapped secret key is scoped to the CALLER, symmetrically: a shared
// conversation with two participants, each holding their own current-gen
// wrapped key, must return to each caller ONLY their own key — never the
// other participant's. Proven from both perspectives so the join filter can't
// regress into "return the first/any wrapped key".
func TestConversationListWrappedKeyScopedToEachCaller(t *testing.T) {
	t.Parallel()

	const (
		conversationID = "embedperc000001"
		pubKey         = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
		pubKeySig      = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
		user1Wrapped   = "MQ11c2VyMXdyYXBwZWRzZWNyZXRrZXl2YWx1ZTAwMDA="
		user2Wrapped   = "Mg22c2VyMndyYXBwZWRzZWNyZXRrZXl2YWx1ZTAwMDA="
	)

	seed := func(t testing.TB, app *tests.TestApp) {
		seedOwnedConversation(t, app, conversationID, "test1@example.com")
		seedParticipant(t, app, conversationID, userID(t, app, "test2@example.com"), "Editor")
		seedConversationKeyMaterial(
			t, app, conversationID, userID(t, app, "test1@example.com"),
			1, pubKey, pubKeySig, user1Wrapped,
		)
		seedConversationKeyMaterial(
			t, app, conversationID, userID(t, app, "test2@example.com"),
			1, pubKey, pubKeySig, user2Wrapped,
		)
	}

	cases := []struct {
		callerEmail string
		ownWrapped  string
		otherWrap   string
	}{
		{"test1@example.com", user1Wrapped, user2Wrapped},
		{"test2@example.com", user2Wrapped, user1Wrapped},
	}

	for _, tc := range cases {
		tc := tc
		scenario := tests.ApiScenario{
			Name:            "wrapped key scoped to caller " + tc.callerEmail,
			Method:          http.MethodGet,
			URL:             "/api/v1/conversations",
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"wrapped_secret_key":"` + tc.ownWrapped + `"`},
			TestAppFactory:  setupTestApp,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				seed(t, app)
				withRecordAuth("users", tc.callerEmail)(t, app, e)
			},
			AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
				body, err := io.ReadAll(res.Body)
				if err != nil {
					t.Fatalf("ReadAll(response.Body) error = %v", err)
				}
				if strings.Contains(string(body), tc.otherWrap) {
					t.Fatalf("caller %q list leaked another participant's wrapped key: %s", tc.callerEmail, string(body))
				}
			},
		}
		scenario.Test(t)
	}
}

// If the caller is a participant but has no wrapped key at the conversation's
// CURRENT generation (e.g. only a stale pre-rotation row), the list must omit
// the key fields entirely — it must never fall back to embedding the stale
// wrapped key, which the caller can no longer use and which would be a
// forward-secrecy leak after a rotation.
func TestConversationListOmitsStaleWrappedKeyWhenMissingCurrentGeneration(t *testing.T) {
	t.Parallel()

	const (
		conversationID = "embedstale00001"
		pubKeyV2       = "djIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
		staleWrappedV1 = "c3RhbGV3cmFwcGVkdjFzZWNyZXRrZXl2YWx1ZTAwMA=="
	)

	scenario := tests.ApiScenario{
		Name:            "list omits a stale wrapped key the caller can no longer use",
		Method:          http.MethodGet,
		URL:             "/api/v1/conversations",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"id":"` + conversationID + `"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			uid := userID(t, app, "test1@example.com")
			// Current generation is 2 with a v2 public key, but the caller
			// only holds a v1 wrapped key.
			seedConversationKeyMaterial(t, app, conversationID, uid, 1, pubKeyV2, pubKeyV2, staleWrappedV1)
			record, err := app.FindRecordById("conversations", conversationID)
			if err != nil {
				t.Fatalf("FindRecordById(conversations) error = %v", err)
			}
			record.Set("key_version", 2)
			if err := app.Save(record); err != nil {
				t.Fatalf("Save(conversation key_version=2) error = %v", err)
			}
			// Seed a v2 public key (+ another user's v2 secret key) so that at
			// the current generation only THIS caller's secret key is missing.
			seedConversationKeyMaterial(t, app, conversationID, userID(t, app, "test2@example.com"), 2, pubKeyV2, pubKeyV2, "djJvdGhlcndyYXBwZWRzZWNyZXRrZXl2YWx1ZTAwMA==")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(response.Body) error = %v", err)
			}
			if strings.Contains(string(body), staleWrappedV1) {
				t.Fatalf("list embedded a stale (pre-rotation) wrapped key: %s", string(body))
			}
			var entries []listConversationEntry
			if err := json.Unmarshal(body, &entries); err != nil {
				t.Fatalf("json.Unmarshal(ConversationsList) error = %v; body = %s", err, string(body))
			}
			entry := conversationListEntry(t, entries, conversationID)
			if entry.WrappedSecretKey != "" {
				t.Fatalf("expected wrapped key omitted, got %q", entry.WrappedSecretKey)
			}
		},
	}

	scenario.Test(t)
}

// A non-participant must never see another user's conversation OR its key
// material through their own list. The outsider has their own conversation so
// the list is non-empty; the foreign conversation id, public key, and wrapped
// key must all be absent.
func TestConversationListOutsiderNeverSeesForeignKeyMaterial(t *testing.T) {
	t.Parallel()

	const (
		ownerConversationID    = "embedowner00001"
		outsiderConversationID = "embedoutsidr001"
		ownerPubKey            = "b3duZXJwdWJsaWNrZXl2YWx1ZTAwMDAwMDAwMDAwMDA="
		ownerPubKeySig         = "b3duZXJwdWJsaWNrZXlzaWduYXR1cmV2YWx1ZTAwMDA="
		ownerWrapped           = "b3duZXJ3cmFwcGVkc2VjcmV0a2V5dmFsdWUwMDAwMDA="
	)

	scenario := tests.ApiScenario{
		Name:            "outsider list excludes foreign conversation and its keys",
		Method:          http.MethodGet,
		URL:             "/api/v1/conversations",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"id":"` + outsiderConversationID + `"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			// Owner's fully-keyed conversation.
			seedOwnedConversation(t, app, ownerConversationID, "test1@example.com")
			seedConversationKeyMaterial(
				t, app, ownerConversationID, userID(t, app, "test1@example.com"),
				1, ownerPubKey, ownerPubKeySig, ownerWrapped,
			)
			// Outsider has their own (key-less) conversation so the list isn't empty.
			seedOwnedConversation(t, app, outsiderConversationID, "test2@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			body, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("ReadAll(response.Body) error = %v", err)
			}
			for _, leak := range []string{ownerConversationID, ownerPubKey, ownerPubKeySig, ownerWrapped} {
				if strings.Contains(string(body), leak) {
					t.Fatalf("outsider list leaked foreign material %q: %s", leak, string(body))
				}
			}
		},
	}

	scenario.Test(t)
}

// A conversation whose current-generation key material is missing omits the
// key fields rather than failing the whole list — the client falls back to the
// per-conversation endpoints for that one.
func TestConversationListOmitsKeysWhenMissing(t *testing.T) {
	t.Parallel()

	const conversationID = "embednokeys0001"

	scenario := tests.ApiScenario{
		Name:            "conversation list omits key fields when key material is missing",
		Method:          http.MethodGet,
		URL:             "/api/v1/conversations",
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"id":"` + conversationID + `"`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			entries := decodeConversationList(t, res)
			entry := conversationListEntry(t, entries, conversationID)
			if entry.PublicKey != "" || entry.PublicKeySignature != "" || entry.WrappedSecretKey != "" {
				t.Fatalf("expected key fields omitted, got %+v", entry)
			}
		},
	}

	scenario.Test(t)
}
