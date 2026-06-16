package main

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestAccountDeleteRequiresAuth(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "account delete requires record auth",
		Method:          http.MethodDelete,
		URL:             "/api/v1/account",
		ExpectedStatus:  http.StatusUnauthorized,
		ExpectedContent: []string{`"message":"The request requires valid record authorization token."`},
		TestAppFactory:  setupTestApp,
	}

	scenario.Test(t)
}

func TestAccountDeleteErasesUserAndOwnChats(t *testing.T) {
	t.Parallel()

	conversationID := "acctdelconv0001"

	scenario := tests.ApiScenario{
		Name:           "deleting the account removes the user and their conversations",
		Method:         http.MethodDelete,
		URL:            "/api/v1/account",
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOwnedConversation(t, app, conversationID, "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindAuthRecordByEmail("users", "test1@example.com"); err == nil {
				t.Fatal("user record still exists after account deletion")
			}
			if _, err := app.FindRecordById("conversations", conversationID); err == nil {
				t.Fatalf("conversation %q still exists after account deletion", conversationID)
			}
		},
	}

	scenario.Test(t)
}

func TestAccountDeleteBlockedWhileOnPaidPlan(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "account delete is refused while a paid plan is active",
		Method:          http.MethodDelete,
		URL:             "/api/v1/account",
		ExpectedStatus:  http.StatusConflict,
		ExpectedContent: []string{`Cancel your plan before deleting your account`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedUserBilling(t, app, "test1@example.com", "unlimited")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			// The user must still exist — deletion was refused.
			if _, err := app.FindAuthRecordByEmail("users", "test1@example.com"); err != nil {
				t.Fatalf("user record was deleted despite an active paid plan: %v", err)
			}
		},
	}

	scenario.Test(t)
}

func TestAccountDeleteRetainsFinancialRecords(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:           "deleting the account retains (detaches) billing records",
		Method:         http.MethodDelete,
		URL:            "/api/v1/account",
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			// An inactive billing row is allowed to delete, and must survive the
			// deletion (financial retention) rather than cascade away.
			seedUserBilling(t, app, "test1@example.com", "inactive")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindAuthRecordByEmail("users", "test1@example.com"); err == nil {
				t.Fatal("user record still exists after account deletion")
			}
			records, err := app.FindAllRecords("user_billing")
			if err != nil {
				t.Fatalf("FindAllRecords(user_billing) error = %v", err)
			}
			if len(records) == 0 {
				t.Fatal("user_billing record was removed; financial records must be retained")
			}
		},
	}

	scenario.Test(t)
}

// seedUserBilling sets the user's billing plan_type, reusing the row
// setupTestApp already seeds for the user (the relation is unique per user).
func seedUserBilling(t testing.TB, app *tests.TestApp, ownerEmail, planType string) {
	t.Helper()

	userRecord, err := app.FindAuthRecordByEmail("users", ownerEmail)
	if err != nil {
		t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v", ownerEmail, err)
	}

	collection, err := app.FindCollectionByNameOrId("user_billing")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(user_billing) error = %v", err)
	}

	record, err := app.FindFirstRecordByData("user_billing", "user_id", userRecord.Id)
	if err != nil {
		record = core.NewRecord(collection)
		record.Set("user_id", userRecord.Id)
		record.Set("balance_rappen", 0)
	}
	record.Set("plan_type", planType)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(user_billing) error = %v", err)
	}
}
