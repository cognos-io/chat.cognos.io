package main

import (
	"fmt"
	"net/http"
	"testing"

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

func TestConversationFilterRules(t *testing.T) {
	t.Parallel()

	const collectionName = "conversations"
	url := fmt.Sprintf("/api/collections/%s/records", collectionName)

	recordToken, err := generateRecordToken("users", "test1@example.com")
	if err != nil {
		t.Fatal(err)
	}

	setupTestApp := func(t *testing.T) *tests.TestApp {
		app, err := tests.NewTestApp(testDataDir)
		if err != nil {
			t.Fatal(err)
		}
		return app
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
