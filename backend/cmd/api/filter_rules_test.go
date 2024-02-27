/*
 * These tests check the API rules and filters for the PocketBase collections.
 * To ensure proper rule coverage, we should ensure we're checking the following:
 * 	   - List/Search
 *     - View
 *     - Create
 *     - Update
 *     - Delete
 *
 * For each of these operations we should check the following:
 *     - As a guest (non-authenticated user)
 *     - As a user with a record token
 *     - As a user with a record token trying to access another users data
 *
 * That means each collection should have at least 15 tests.
 */
package main

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/config"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tokens"
)

const testDataDir = "../../testdata/pb_data"

func generateRecordToken(collectionNameOrId string, email string) (string, error) {
	app, err := tests.NewTestApp(testDataDir)
	if err != nil {
		return "", err
	}
	defer app.Cleanup()

	record, err := app.Dao().FindAuthRecordByEmail(collectionNameOrId, email)
	if err != nil {
		return "", err
	}

	return tokens.NewRecordAuthToken(app, record)
}

func setupTestApp(t *testing.T) *tests.TestApp {
	app, err := tests.NewTestApp(testDataDir)
	if err != nil {
		t.Fatal(err)
	}

	testConfig := config.APIConfig{}

	bindAppHooks(app, &testConfig, nil)

	return app
}

func TestConversationFilterRules(t *testing.T) {
	t.Parallel()

	const collectionName = "conversations"
	url := fmt.Sprintf("/api/collections/%s/records", collectionName)

	recordToken, err := generateRecordToken("users", "test1@example.com")
	if err != nil {
		t.Fatal(err)
	}

	// Useful reference: https://github.com/presentator/presentator/blob/7200691263d5438d167118e1d013e2ac2de7390e/api_users_test.go
	scenarios := []tests.ApiScenario{
		{
			Name:            "list conversations as guest",
			Method:          http.MethodGet,
			Url:             url,
			RequestHeaders:  map[string]string{},
			ExpectedStatus:  http.StatusOK,
			ExpectedEvents:  map[string]int{"OnRecordsListRequest": 1},
			ExpectedContent: []string{"\"items\":[]"},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:   "list conversations via user token",
			Method: http.MethodGet,
			Url:    url,
			RequestHeaders: map[string]string{
				"Authorization": recordToken,
			},
			ExpectedStatus:  http.StatusOK,
			ExpectedEvents:  map[string]int{"OnRecordsListRequest": 1},
			ExpectedContent: []string{"\"items\":[]"},
			TestAppFactory:  setupTestApp,
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func TestUserKeyPairFilterRules(t *testing.T) {
	t.Parallel()

	const (
		collectionName = "user_key_pairs"
		// Get this info from the pre-populated test DB
		userEmail              = "test1@example.com"
		userId                 = "uvi8zmr78j9y5hz"
		userPublicKey          = "FaTq77hDYWu9pNLMwBlQ4Ks54BAfwz1Y7/nmyZTLkTE="
		userEncryptedSecretKey = "xi1EQyn4P+UgOuMKCL3RPtUEMZ43VnHT6XVxH++Dw0Y+OH+gihK/axp4sR7jxWWQzs0BIrq1L77tem6KSZaJGqFNjtjTt89x"
	)

	url := fmt.Sprintf("/api/collections/%s/records", collectionName)

	recordToken, err := generateRecordToken("users", userEmail)
	if err != nil {
		t.Fatal(err)
	}

	scenarios := []tests.ApiScenario{
		// List/Search
		{
			Name:            "list user key pairs as guest",
			Method:          http.MethodGet,
			Url:             url,
			RequestHeaders:  map[string]string{},
			ExpectedStatus:  http.StatusOK,
			ExpectedEvents:  map[string]int{"OnRecordsListRequest": 1},
			ExpectedContent: []string{`"items":[]`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:   "list user key pairs via user token",
			Method: http.MethodGet,
			Url:    url,
			RequestHeaders: map[string]string{
				"Authorization": recordToken,
			},
			ExpectedStatus:  http.StatusOK,
			ExpectedEvents:  map[string]int{"OnRecordsListRequest": 1},
			ExpectedContent: []string{`"totalItems":1`, `"id":"3gtr36mn54ldo53"`},
			TestAppFactory:  setupTestApp,
		},
		// View specific record
		{
			Name:            "get user key pair as guest",
			Method:          http.MethodGet,
			Url:             fmt.Sprintf("%s/3gtr36mn54ldo53", url),
			RequestHeaders:  map[string]string{},
			ExpectedStatus:  http.StatusNotFound,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:   "get user key pair via user token",
			Method: http.MethodGet,
			Url:    fmt.Sprintf("%s/3gtr36mn54ldo53", url),
			RequestHeaders: map[string]string{
				"Authorization": recordToken,
			},
			ExpectedStatus:  http.StatusOK,
			ExpectedEvents:  map[string]int{"OnRecordViewRequest": 1},
			ExpectedContent: []string{`"id":"3gtr36mn54ldo53"`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:   "get another users key pair via user token",
			Method: http.MethodGet,
			Url:    fmt.Sprintf("%s/nekxd2byk1j1cof", url),
			RequestHeaders: map[string]string{
				"Authorization": recordToken,
			},
			ExpectedStatus:  http.StatusNotFound,
			ExpectedEvents:  map[string]int{},
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
		},
		// Create
		{
			Name:           "create user key pair as guest",
			Method:         http.MethodPost,
			Url:            url,
			RequestHeaders: map[string]string{},
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": "%s",
				"public_key": "%s",
				"secret_key": "%s"
			}`, userId, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedEvents:  map[string]int{},
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:   "create user key pair via user token",
			Method: http.MethodPost,
			Url:    url,
			RequestHeaders: map[string]string{
				"Authorization": recordToken,
			},
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": "%s",
				"public_key": "%s",
				"secret_key": "%s"
			}`, userId, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus: http.StatusOK,
			ExpectedEvents: map[string]int{
				"OnModelAfterCreate":          1,
				"OnModelBeforeCreate":         1,
				"OnRecordAfterCreateRequest":  1,
				"OnRecordBeforeCreateRequest": 1,
			},
			ExpectedContent: []string{fmt.Sprintf(`"public_key":"%s"`, userPublicKey)},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:   "create user key pair via user token with missing user ID",
			Method: http.MethodPost,
			Url:    url,
			RequestHeaders: map[string]string{
				"Authorization": recordToken,
			},
			Body: strings.NewReader(fmt.Sprintf(`{
				"public_key": "%s",
				"secret_key": "%s"
			}`, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:   "create user key pair via user token with invalid keys",
			Method: http.MethodPost,
			Url:    url,
			RequestHeaders: map[string]string{
				"Authorization": recordToken,
			},
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": "%s",
				"public_key": "im-not-a-valid-key",
				"secret_key": "%s"
			}`, userId, userEncryptedSecretKey)),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`data":{"public_key":`, `"message":"Must be at least 32 character(s)."`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:   "create another users key pair via user token",
			Method: http.MethodPost,
			Url:    url,
			RequestHeaders: map[string]string{
				"Authorization": recordToken,
			},
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": "xq9ndvc2kbrvrng",
				"public_key": "%s",
				"secret_key": "%s"
			}`, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:   "create a key pair with a fixed ID",
			Method: http.MethodPost,
			Url:    url,
			RequestHeaders: map[string]string{
				"Authorization": recordToken,
			},
			Body: strings.NewReader(fmt.Sprintf(`{
				"id": "k7prcx11dum2l3k",
				"user": "%s",
				"public_key": "%s",
				"secret_key": "%s"
			}`, userId, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
		},
		{
			Name:   "create a key pair with a fixed created & modified",
			Method: http.MethodPost,
			Url:    url,
			RequestHeaders: map[string]string{
				"Authorization": recordToken,
			},
			Body: strings.NewReader(fmt.Sprintf(`{
				"user": "%s",
				"public_key": "%s",
				"secret_key": "%s",
				"created": "2021-01-01T00:00:00Z",
				"modified": "2021-01-01T00:00:00Z"
			}`, userId, userPublicKey, userEncryptedSecretKey)),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"data":{}`},
			TestAppFactory:  setupTestApp,
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}
