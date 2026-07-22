package main

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestAccountDeleteRequiresCurrentPassword(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "account delete rejects an incorrect password",
		Method:          http.MethodDelete,
		URL:             "/api/v1/account",
		Body:            strings.NewReader(`{"password":"incorrect-password"}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{`"message":"Incorrect password.`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc:  withRecordAuth("users", testUserEmail),
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindAuthRecordByEmail("users", testUserEmail); err != nil {
				t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v, want user retained", testUserEmail, err)
			}
		},
	}

	scenario.Test(t)
}

func TestAccountDeleteRequiresTOTPWhenMFAEnabled(t *testing.T) {
	t.Parallel()

	scenario := tests.ApiScenario{
		Name:            "account delete rejects a missing MFA code",
		Method:          http.MethodDelete,
		URL:             "/api/v1/account",
		Body:            strings.NewReader(`{"password":"` + testUserPassword + `"}`),
		ExpectedStatus:  http.StatusBadRequest,
		ExpectedContent: []string{`"message":"Incorrect code.`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			enrollVerifiedTOTP(t.(*testing.T), app)
			withRecordAuth("users", testUserEmail)(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindAuthRecordByEmail("users", testUserEmail); err != nil {
				t.Fatalf("FindAuthRecordByEmail(users, %q) error = %v, want user retained", testUserEmail, err)
			}
		},
	}

	scenario.Test(t)
}

func TestAccountDeleteAcceptsPasswordAndTOTP(t *testing.T) {
	t.Parallel()

	const secret = "JBSWY3DPEHPK3PXP"
	code := totpCodeNow(t, secret)
	scenario := tests.ApiScenario{
		Name:           "account delete accepts both factors when MFA is enabled",
		Method:         http.MethodDelete,
		URL:            "/api/v1/account",
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			enrollVerifiedTOTPSecret(t.(*testing.T), app, secret)
			withRecordAuth("users", testUserEmail)(t, app, e)
		},
		Headers: map[string]string{"Content-Type": "application/json"},
		Body:    strings.NewReader(`{"password":"` + testUserPassword + `","totpCode":"` + code + `"}`),
	}

	scenario.Test(t)
}

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
		Body:           strings.NewReader(`{"password":"` + testUserPassword + `"}`),
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
		Body:            strings.NewReader(`{"password":"` + testUserPassword + `"}`),
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
		Body:           strings.NewReader(`{"password":"` + testUserPassword + `"}`),
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

func TestAccountDeleteRefusesOrganisationOwner(t *testing.T) {
	t.Parallel()

	const orgID = "acctdelorgown01"

	scenario := tests.ApiScenario{
		Name:            "organisation owner cannot delete account until ownership is transferred or dissolved",
		Method:          http.MethodDelete,
		URL:             "/api/v1/account",
		Body:            strings.NewReader(`{"password":"` + testUserPassword + `"}`),
		ExpectedStatus:  http.StatusConflict,
		ExpectedContent: []string{`Transfer ownership or dissolve your Organisation before deleting your account`},
		TestAppFactory:  setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Owner Block AG", "test1@example.com")
			withRecordAuth("users", "test1@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindAuthRecordByEmail("users", "test1@example.com"); err != nil {
				t.Fatalf("owner was deleted despite Organisation ownership: %v", err)
			}
			if _, err := app.FindRecordById("organisations", orgID); err != nil {
				t.Fatalf("organisation %q was removed during refused account deletion: %v", orgID, err)
			}
		},
	}

	scenario.Test(t)
}

func TestAccountDeletePreservesOrganisationProjectCreatedByMember(t *testing.T) {
	t.Parallel()

	const (
		orgID                  = "acctdelorgpj001"
		orgProjectID           = "acctdelorgpj002"
		orgConversationID      = "acctdelorgcv001"
		personalProjectID      = "acctdelperspj01"
		personalConversationID = "acctdelperscv01"
	)

	scenario := tests.ApiScenario{
		Name:           "member account deletion keeps Organisation Projects and Conversations they created",
		Method:         http.MethodDelete,
		URL:            "/api/v1/account",
		Body:           strings.NewReader(`{"password":"` + testUserPassword + `"}`),
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Survive AG", "test1@example.com")
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			// Member created the shared Project — the P0 bug deleted these by creator.
			seedOrgOwnedProject(t, app, orgProjectID, orgID, "test2@example.com")
			owner, err := app.FindAuthRecordByEmail("users", "test1@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(users, test1) error = %v", err)
			}
			seedProjectParticipant(t, app, orgProjectID, owner.Id, "Admin")
			seedProjectConversation(t, app, orgProjectID, orgConversationID, "test2@example.com")
			seedOwnedProject(t, app, personalProjectID, "test2@example.com")
			seedOwnedConversation(t, app, personalConversationID, "test2@example.com")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindAuthRecordByEmail("users", "test2@example.com"); err == nil {
				t.Fatal("member user record still exists after account deletion")
			}
			if _, err := app.FindRecordById("projects", orgProjectID); err != nil {
				t.Fatalf("organisation project %q was deleted with the member account: %v", orgProjectID, err)
			}
			if _, err := app.FindRecordById("conversations", orgConversationID); err != nil {
				t.Fatalf("organisation conversation %q was deleted with the member account: %v", orgConversationID, err)
			}
			if _, err := app.FindRecordById("projects", personalProjectID); err == nil {
				t.Fatalf("personal project %q still exists after account deletion", personalProjectID)
			}
			if _, err := app.FindRecordById("conversations", personalConversationID); err == nil {
				t.Fatalf("personal conversation %q still exists after account deletion", personalConversationID)
			}
		},
	}

	scenario.Test(t)
}

func TestAccountDeleteOffboardsOrdinaryOrganisationMember(t *testing.T) {
	t.Parallel()

	const (
		orgID        = "acctdelorgmb001"
		orgProjectID = "acctdelorgmbpj1"
	)

	scenario := tests.ApiScenario{
		Name:           "ordinary member is offboarded with Project access revoked and rotation marked pending",
		Method:         http.MethodDelete,
		URL:            "/api/v1/account",
		Body:           strings.NewReader(`{"password":"` + testUserPassword + `"}`),
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Offboard AG", "test1@example.com")
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			seedOrgOwnedProject(t, app, orgProjectID, orgID, "test1@example.com")
			member, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(users, test2) error = %v", err)
			}
			seedProjectParticipant(t, app, orgProjectID, member.Id, "Editor")
			// Pin: invite-accept style audit rows (member as actor) must detach,
			// not block Account deletion.
			seedOrgAuditEvent(t, app, orgID, member.Id, "org.invite.accepted", member.Id, time.Now().UTC())
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindAuthRecordByEmail("users", "test2@example.com"); err == nil {
				t.Fatal("member user record still exists after account deletion")
			}

			project, err := app.FindRecordById("projects", orgProjectID)
			if err != nil {
				t.Fatalf("organisation project %q missing after member deletion: %v", orgProjectID, err)
			}
			if !project.GetBool("rotation_pending") {
				t.Fatal("organisation project rotation_pending = false, want true after member offboard")
			}

			// Membership and participation rows cascade off the deleted user;
			// pin that no active membership/participant remains for the org project.
			memberships, err := app.FindRecordsByFilter(
				"org_memberships",
				"organisation = {:org} && removed_at = ''",
				"",
				0,
				0,
				dbx.Params{"org": orgID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(org_memberships) error = %v", err)
			}
			if len(memberships) != 1 {
				t.Fatalf("active org memberships = %d, want 1 (owner only)", len(memberships))
			}

			participants, err := app.FindRecordsByFilter(
				"project_participants",
				"project = {:project} && removed_at = ''",
				"",
				0,
				0,
				dbx.Params{"project": orgProjectID},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(project_participants) error = %v", err)
			}
			if len(participants) != 1 {
				t.Fatalf("active project participants = %d, want 1 (remaining Admin)", len(participants))
			}

			events, err := app.FindRecordsByFilter(
				"org_audit_events",
				"organisation = {:org} && action = {:action}",
				"",
				0,
				0,
				dbx.Params{"org": orgID, "action": "org.invite.accepted"},
			)
			if err != nil {
				t.Fatalf("FindRecordsByFilter(org_audit_events) error = %v", err)
			}
			if len(events) != 1 {
				t.Fatalf("retained invite-accepted audit rows = %d, want 1", len(events))
			}
			if got := events[0].GetString("actor"); got != "" {
				t.Fatalf("audit actor = %q, want empty (detached after Account deletion)", got)
			}
		},
	}

	scenario.Test(t)
}

func TestAccountDeleteRetainsFinancialRecordsWhileErasingPersonalData(t *testing.T) {
	t.Parallel()

	const (
		orgID                  = "acctdelfinorg01"
		orgProjectID           = "acctdelfinpj001"
		personalConversationID = "acctdelfincv001"
	)

	scenario := tests.ApiScenario{
		Name:           "personal data deletes while Organisation content and detached financial records survive",
		Method:         http.MethodDelete,
		URL:            "/api/v1/account",
		Body:           strings.NewReader(`{"password":"` + testUserPassword + `"}`),
		ExpectedStatus: http.StatusNoContent,
		TestAppFactory: setupTestApp,
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			seedOrganisation(t, app, orgID, "Finance AG", "test1@example.com")
			seedOrgMembership(t, app, orgID, "test2@example.com", "member", false)
			seedOrgOwnedProject(t, app, orgProjectID, orgID, "test1@example.com")
			member, err := app.FindAuthRecordByEmail("users", "test2@example.com")
			if err != nil {
				t.Fatalf("FindAuthRecordByEmail(users, test2) error = %v", err)
			}
			seedProjectParticipant(t, app, orgProjectID, member.Id, "Editor")
			seedOwnedConversation(t, app, personalConversationID, "test2@example.com")
			seedUserBilling(t, app, "test2@example.com", "inactive")
			withRecordAuth("users", "test2@example.com")(t, app, e)
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			if _, err := app.FindAuthRecordByEmail("users", "test2@example.com"); err == nil {
				t.Fatal("user record still exists after account deletion")
			}
			if _, err := app.FindRecordById("conversations", personalConversationID); err == nil {
				t.Fatalf("personal conversation %q still exists after account deletion", personalConversationID)
			}
			if _, err := app.FindRecordById("projects", orgProjectID); err != nil {
				t.Fatalf("organisation project %q was deleted: %v", orgProjectID, err)
			}
			records, err := app.FindAllRecords("user_billing")
			if err != nil {
				t.Fatalf("FindAllRecords(user_billing) error = %v", err)
			}
			foundDetached := false
			for _, record := range records {
				if record.GetString("user_id") == "" {
					foundDetached = true
					break
				}
			}
			if !foundDetached {
				t.Fatal("expected a detached user_billing row after account deletion")
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
