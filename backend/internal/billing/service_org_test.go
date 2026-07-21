package billing

import (
	"strings"
	"testing"
)

// EvaluateOrgAccess is the fail-closed gate for org-billed requests (see
// docs/business_processes/organisation-lifecycle.md): only an active payg org passes;
// inactive (including a missing org_billing row, which StateForOrg maps to
// inactive) and past_due both 402 with an ORG_* code — never falling back to
// the member's personal balance. Member-facing copy stays neutral (never the
// member's fault) while the admin message carries the one actionable step.
func TestEvaluateOrgAccess(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		resolved      ResolvedState
		wantError     string
		wantNextStep  string
		wantAdminHint string
	}{
		{
			name: "active payg org passes",
			resolved: ResolvedState{
				Subject: OrgSubject("org1"),
				State:   State{PlanType: PlanTypePayG},
			},
		},
		{
			name: "personal subject is never org-gated",
			resolved: ResolvedState{
				Subject: UserSubject("user1"),
				State:   State{PlanType: PlanTypeInactive, PastDue: true},
			},
		},
		{
			name: "inactive org blocks with the org code",
			resolved: ResolvedState{
				Subject:          OrgSubject("org1"),
				State:            State{PlanType: PlanTypeInactive},
				OrganisationName: "Acme GmbH",
			},
			wantError:     OrgBillingInactiveError,
			wantNextStep:  "org_subscribe",
			wantAdminHint: "Reactivate",
		},
		{
			name: "past due org blocks even though the plan is still payg",
			resolved: ResolvedState{
				Subject:          OrgSubject("org1"),
				State:            State{PlanType: PlanTypePayG, PastDue: true},
				OrganisationName: "Acme GmbH",
			},
			wantError:     OrgBillingPastDueError,
			wantNextStep:  "org_update_payment",
			wantAdminHint: "payment method",
		},
		{
			name: "trial can never leak into an org subject — treated as not payg",
			resolved: ResolvedState{
				Subject:          OrgSubject("org1"),
				State:            State{PlanType: PlanTypeTrial, BalanceMicroRappen: 1_000_000_000},
				OrganisationName: "Acme GmbH",
			},
			wantError:    OrgBillingInactiveError,
			wantNextStep: "org_subscribe",
		},
	}

	service := NewService()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := service.EvaluateOrgAccess(tt.resolved)

			if tt.wantError == "" {
				if got != nil {
					t.Fatalf("EvaluateOrgAccess() = %+v, want nil (pass)", got)
				}
				return
			}
			if got == nil {
				t.Fatalf("EvaluateOrgAccess() = nil, want %q restriction", tt.wantError)
			}
			if got.Error != tt.wantError {
				t.Errorf("Error = %q, want %q", got.Error, tt.wantError)
			}
			if got.NextStep != tt.wantNextStep {
				t.Errorf("NextStep = %q, want %q", got.NextStep, tt.wantNextStep)
			}
			if got.OrganisationID != "org1" {
				t.Errorf("OrganisationID = %q, want %q", got.OrganisationID, "org1")
			}
			if got.OrganisationName != tt.resolved.OrganisationName {
				t.Errorf("OrganisationName = %q, want %q", got.OrganisationName, tt.resolved.OrganisationName)
			}
			// The member message names the org, stays neutral and points the
			// member at their personal workspace; the admin message carries
			// the single actionable step.
			if tt.resolved.OrganisationName != "" &&
				!strings.Contains(got.Message, tt.resolved.OrganisationName) {
				t.Errorf("Message = %q, want it to name the organisation", got.Message)
			}
			if strings.Contains(strings.ToLower(got.Message), "your fault") {
				t.Errorf("Message = %q, must never blame the member", got.Message)
			}
			if got.AdminMessage == "" {
				t.Error("AdminMessage is empty, want the actionable admin step")
			}
			if tt.wantAdminHint != "" && !strings.Contains(got.AdminMessage, tt.wantAdminHint) {
				t.Errorf("AdminMessage = %q, want it to contain %q", got.AdminMessage, tt.wantAdminHint)
			}
		})
	}
}

// A nameless org (dangling relation mid-dissolution) must still fail closed
// with sensible copy rather than an awkward empty interpolation.
func TestEvaluateOrgAccessHandlesMissingName(t *testing.T) {
	t.Parallel()

	got := NewService().EvaluateOrgAccess(ResolvedState{
		Subject: OrgSubject("org1"),
		State:   State{PlanType: PlanTypeInactive},
	})
	if got == nil {
		t.Fatal("EvaluateOrgAccess() = nil, want a restriction")
	}
	if strings.Contains(got.Message, "  ") || strings.HasPrefix(got.Message, " ") {
		t.Errorf("Message = %q, has broken interpolation", got.Message)
	}
}
