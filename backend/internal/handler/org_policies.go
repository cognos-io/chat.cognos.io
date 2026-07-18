package handler

import (
	"net/http"
	"strings"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue"
	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

type updateOrgPoliciesRequest struct {
	PolicyPrivacyTier   *string `json:"policy_privacy_tier,omitempty"`
	PolicyRetentionDays *int    `json:"policy_retention_days,omitempty"`
	PolicyMFARequired   *bool   `json:"policy_mfa_required,omitempty"`
}

// OrganisationPoliciesUpdate handles PATCH /api/v1/orgs/{orgID}/policies.
// Only owners and admins may modify policy settings.
func OrganisationPoliciesUpdate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		org, role, err := memberOrganisationOr404(app, e)
		if err != nil {
			return err
		}
		if !role.CanManage() {
			return apis.NewForbiddenError("Only organisation owners and admins can update policies", nil)
		}

		var req updateOrgPoliciesRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Failed to read request data", err)
		}

		record, err := app.FindRecordById("organisations", org.ID)
		if err != nil {
			return apis.NewNotFoundError("Organisation not found", err)
		}

		if req.PolicyPrivacyTier != nil {
			tier := strings.TrimSpace(*req.PolicyPrivacyTier)
			if tier != "" && tier != "ch_only" && tier != "eu" && tier != "global" {
				return apis.NewBadRequestError("Invalid privacy tier", nil)
			}
			record.Set("policy_privacy_tier", tier)
		}
		if req.PolicyRetentionDays != nil {
			if *req.PolicyRetentionDays < 0 {
				return apis.NewBadRequestError("Retention days cannot be negative", nil)
			}
			record.Set("policy_retention_days", *req.PolicyRetentionDays)
		}
		if req.PolicyMFARequired != nil {
			record.Set("policy_mfa_required", *req.PolicyMFARequired)
		}

		if err := app.Save(record); err != nil {
			return organisationWriteError("Failed to update organisation policies", err)
		}

		return e.JSON(http.StatusOK, organisationToResponse(organisationFromRecord(record), role))
	}
}

// organisationFromRecord builds an Organisation from a PocketBase record.
func organisationFromRecord(record *core.Record) organisations.Organisation {
	return organisations.Organisation{
		ID:                  record.Id,
		Name:                record.GetString("name"),
		OwnerID:             record.GetString("owner"),
		Created:             record.GetString("created"),
		Updated:             record.GetString("updated"),
		PolicyPrivacyTier:   record.GetString("policy_privacy_tier"),
		PolicyRetentionDays: record.GetInt("policy_retention_days"),
		PolicyMFARequired:   record.GetBool("policy_mfa_required"),
	}
}

// requireOrgMFA returns a 403 ORG_MFA_REQUIRED error when the organisation
// requires MFA and the user has not enabled it. Callers must have already
// confirmed the user has access to the org-owned resource.
func requireOrgMFA(app core.App, orgID, userID string) error {
	if orgID == "" || userID == "" {
		return nil
	}
	org, err := app.FindRecordById("organisations", orgID)
	if err != nil {
		return nil
	}
	if !org.GetBool("policy_mfa_required") {
		return nil
	}
	user, err := app.FindRecordById("users", userID)
	if err != nil {
		return apis.NewApiError(http.StatusInternalServerError, "Failed to verify user MFA status", err)
	}
	if !user.GetBool("mfa_enabled") {
		return apis.NewForbiddenError("ORG_MFA_REQUIRED: Multi-factor authentication is required for this organisation. Enable MFA in your account security settings.", nil)
	}
	return nil
}

// orgPrivacyCeiling returns the organisation's privacy tier ceiling when set.
// An empty org tier means no ceiling applies.
func orgPrivacyCeiling(app core.App, orgID string) (catalogue.PrivacyTier, bool) {
	if orgID == "" {
		return "", false
	}
	org, err := app.FindRecordById("organisations", orgID)
	if err != nil {
		return "", false
	}
	tier := org.GetString("policy_privacy_tier")
	if tier == "" {
		return "", false
	}
	return catalogue.NormalizePrivacyTier(tier), true
}
