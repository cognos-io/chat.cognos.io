package main

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestUserKeyPairGetReturnsOwnedRecord(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "user key pair route returns owned record",
		Method:         http.MethodGet,
		URL:            "/api/v1/user-key-pair",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"3gtr36mn54ldo53"`,
			`"user":"uvi8zmr78j9y5hz"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestUserKeyPairUpdateUpdatesRecordMAC(t *testing.T) {
	t.Parallel()

	const recordMAC = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="

	scenario := tests.ApiScenario{
		Name:   "user key pair route updates record mac",
		Method: http.MethodPatch,
		URL:    "/api/v1/user-key-pair/3gtr36mn54ldo53",
		Body: strings.NewReader(fmt.Sprintf(`{
			"record_mac": %q
		}`, recordMAC)),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"record_mac":"` + recordMAC + `"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}

	scenario.Test(t)
}

func TestUserKeyPairCreateCreatesOwnedRecord(t *testing.T) {
	t.Parallel()

	const userID = "userkpcreate001"
	const userEmail = "ukp-create@example.com"

	withUserToken := func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			t.Fatalf("FindCollectionByNameOrId(users) error = %v", err)
		}

		record := core.NewRecord(users)
		record.Id = userID
		record.Set("email", userEmail)
		record.Set("username", "ukpcreate")
		record.Set("verified", true)
		record.SetPassword("password1234")
		if err := app.Save(record); err != nil {
			t.Fatalf("Save(users) error = %v", err)
		}

		e.Router.BindFunc(func(re *core.RequestEvent) error {
			re.Auth = record
			return re.Next()
		})
	}

	scenario := tests.ApiScenario{
		Name:   "user key pair route creates owned record",
		Method: http.MethodPost,
		URL:    "/api/v1/user-key-pair",
		Body: strings.NewReader(`{
			"password_salt": "AAAAAAAAAAAAAAAAAAAAAA==",
			"public_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			"record_mac": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			"secret_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
			"unlock_scheme": "password_account_key_v1"
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"user":"` + userID + `"`,
			`"unlock_scheme":"password_account_key_v1"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withUserToken,
	}

	scenario.Test(t)
}

func TestConversationKeyRoutes(t *testing.T) {
	t.Parallel()

	const conversationID = "convkeys0000001"

	createPublicKeyScenario := tests.ApiScenario{
		Name:   "create conversation public key",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/public-key",
		Body: strings.NewReader(`{
			"public_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			"public_key_signature": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"conversation":"` + conversationID + `"`,
			`"public_key_signature":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	createPublicKeyScenario.Test(t)

	getPublicKeyScenario := tests.ApiScenario{
		Name:           "get conversation public key",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/public-key",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"conversation":"` + conversationID + `"`,
			`"public_key":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedConversationPublicKey(t, app, conversationID)
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	getPublicKeyScenario.Test(t)

	createSecretKeyScenario := tests.ApiScenario{
		Name:   "create conversation secret key",
		Method: http.MethodPost,
		URL:    "/api/v1/conversations/" + conversationID + "/secret-key",
		Body: strings.NewReader(`{
			"secret_key": "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC="
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"conversation":"` + conversationID + `"`,
			`"user":"uvi8zmr78j9y5hz"`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	createSecretKeyScenario.Test(t)

	getSecretKeyScenario := tests.ApiScenario{
		Name:           "get conversation secret key",
		Method:         http.MethodGet,
		URL:            "/api/v1/conversations/" + conversationID + "/secret-key",
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"conversation":"` + conversationID + `"`,
			`"secret_key":"CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC="`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedConversationSecretKey(t, app, conversationID, "uvi8zmr78j9y5hz")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	getSecretKeyScenario.Test(t)
}

func TestConversationPublicKeyUpdateRequiresOwnership(t *testing.T) {
	t.Parallel()

	const conversationID = "convkeys0000002"
	const publicKeyID = "convpubkey00001"

	scenario := tests.ApiScenario{
		Name:   "update other user conversation public key returns not found",
		Method: http.MethodPatch,
		URL:    "/api/v1/conversations/" + conversationID + "/public-key/" + publicKeyID,
		Body: strings.NewReader(`{
			"public_key_signature": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
		}`),
		ExpectedStatus: http.StatusNotFound,
		ExpectedContent: []string{
			`"message":"Conversation not found."`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			seedConversationPublicKeyWithID(t, app, publicKeyID, conversationID)
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
	}

	scenario.Test(t)
}

func TestUserPreferencesRoutes(t *testing.T) {
	t.Parallel()

	getMissingScenario := tests.ApiScenario{
		Name:            "get missing user preferences returns not found",
		Method:          http.MethodGet,
		URL:             "/api/v1/user-preferences",
		ExpectedStatus:  http.StatusNotFound,
		ExpectedContent: []string{`"message":"User preferences not found."`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc:  withRecordAuth("users", "test1@example.com"),
	}
	getMissingScenario.Test(t)

	createScenario := tests.ApiScenario{
		Name:   "create user preferences",
		Method: http.MethodPost,
		URL:    "/api/v1/user-preferences",
		Body: strings.NewReader(`{
			"data": "` + base64.StdEncoding.EncodeToString([]byte(`ciphertext`)) + `"
		}`),
		ExpectedStatus: http.StatusCreated,
		ExpectedContent: []string{
			`"user":"uvi8zmr78j9y5hz"`,
			`"data":"Y2lwaGVydGV4dA=="`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: withRecordAuth("users", "test1@example.com"),
	}
	createScenario.Test(t)

	const preferencesID = "prefroute000001"
	updateScenario := tests.ApiScenario{
		Name:   "update user preferences",
		Method: http.MethodPatch,
		URL:    "/api/v1/user-preferences/" + preferencesID,
		Body: strings.NewReader(`{
			"data": "dXBkYXRlZA=="
		}`),
		ExpectedStatus: http.StatusOK,
		ExpectedContent: []string{
			`"id":"` + preferencesID + `"`,
			`"data":"dXBkYXRlZA=="`,
		},
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedUserPreferences(t, app, preferencesID, "uvi8zmr78j9y5hz", "Y2lwaGVydGV4dA==")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
	}
	updateScenario.Test(t)
}

func seedConversationPublicKey(t testing.TB, app *tests.TestApp, conversationID string) {
	t.Helper()
	seedConversationPublicKeyWithID(t, app, "convpubkey00000", conversationID)
}

func seedConversationPublicKeyWithID(t testing.TB, app *tests.TestApp, recordID, conversationID string) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("conversation_public_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_public_keys) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Id = recordID
	record.Set("conversation", conversationID)
	record.Set("public_key", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	record.Set("public_key_signature", "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=")
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(conversation_public_keys) error = %v", err)
	}
}

func seedConversationSecretKey(t testing.TB, app *tests.TestApp, conversationID, userID string) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("conversation_secret_keys")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(conversation_secret_keys) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Id = "convseckey00001"
	record.Set("conversation", conversationID)
	record.Set("secret_key", "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=")
	record.Set("user", userID)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(conversation_secret_keys) error = %v", err)
	}
}

func seedUserPreferences(t testing.TB, app *tests.TestApp, recordID, userID, data string) {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("user_preferences")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(user_preferences) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Id = recordID
	record.Set("user", userID)
	record.Set("data", data)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(user_preferences) error = %v", err)
	}
}
