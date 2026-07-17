package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Organisation handlers (/api/v1/orgs). Access model, per
// docs/api-permissions.md:
//
//   - any authenticated Account may create an Organisation and becomes its
//     owner member;
//   - reads require an ACTIVE membership (soft-revoked rows do not count)
//     and misses return a neutral 404 so organisation ids cannot be probed;
//   - updates additionally require the owner or admin role (403 otherwise).
//
// Everything returned here is operational metadata (names, member ids,
// roles) — never message content, titles, or memory.

type organisationResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Owner      string `json:"owner"`
	CallerRole string `json:"caller_role,omitempty"`
	Created    string `json:"created"`
	Updated    string `json:"updated"`
}

type orgMemberResponse struct {
	UserID  string `json:"user"`
	Role    string `json:"role"`
	AddedAt string `json:"added_at"`
}

type upsertOrganisationRequest struct {
	// Name is the organisation's display name — plaintext operational
	// metadata (an Organisation is not content), validated to 1..120 chars
	// by the collection schema.
	Name string `json:"name"`
}

func OrganisationsCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		name, err := organisationNameFromBody(e)
		if err != nil {
			return err
		}

		repo := organisations.NewPocketBaseRepo(app)
		org, err := repo.Create(name, user.ID)
		if err != nil {
			return organisationWriteError("Failed to create organisation", err)
		}

		return e.JSON(http.StatusCreated, organisationToResponse(org, organisations.RoleOwner))
	}
}

func OrganisationsList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		repo := organisations.NewPocketBaseRepo(app)
		orgs, err := repo.GetForUser(user.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list organisations", err)
		}

		response := make([]organisationResponse, 0, len(orgs))
		for _, org := range orgs {
			response = append(response, organisationToResponse(org.Organisation, org.Role))
		}
		return e.JSON(http.StatusOK, response)
	}
}

func OrganisationsGet(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		org, role, err := memberOrganisationOr404(app, e)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, organisationToResponse(org, role))
	}
}

func OrganisationsUpdate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		org, role, err := memberOrganisationOr404(app, e)
		if err != nil {
			return err
		}
		if !role.CanManage() {
			return apis.NewForbiddenError("Only organisation owners and admins can update the organisation", nil)
		}

		name, err := organisationNameFromBody(e)
		if err != nil {
			return err
		}

		repo := organisations.NewPocketBaseRepo(app)
		renamed, err := repo.Rename(org.ID, name)
		if err != nil {
			return organisationWriteError("Failed to update organisation", err)
		}

		return e.JSON(http.StatusOK, organisationToResponse(renamed, role))
	}
}

func OrganisationMembersList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		org, _, err := memberOrganisationOr404(app, e)
		if err != nil {
			return err
		}

		repo := organisations.NewPocketBaseRepo(app)
		members, err := repo.ListMembers(org.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list organisation members", err)
		}

		response := make([]orgMemberResponse, 0, len(members))
		for _, member := range members {
			response = append(response, orgMemberResponse{
				UserID:  member.UserID,
				Role:    string(member.Role),
				AddedAt: member.AddedAt,
			})
		}
		return e.JSON(http.StatusOK, response)
	}
}

// memberOrganisationOr404 loads the organisation from the {orgID} path value
// only when the caller is an active member, returning the caller's role.
// Non-members and revoked members get 404 — the same shape a missing
// organisation returns — so the response can't be used to probe for ids.
func memberOrganisationOr404(
	app core.App,
	e *core.RequestEvent,
) (organisations.Organisation, organisations.Role, error) {
	user := auth.ExtractUser(e)
	if user == nil {
		return organisations.Organisation{}, "", apis.NewUnauthorizedError("User not authenticated", nil)
	}

	orgID := e.Request.PathValue("orgID")
	record, err := app.FindRecordById(organisations.CollectionName, orgID)
	if err != nil {
		return organisations.Organisation{}, "", apis.NewNotFoundError("Organisation not found", err)
	}

	repo := organisations.NewPocketBaseRepo(app)
	role, active, err := repo.ActiveRole(orgID, user.ID)
	if err != nil {
		return organisations.Organisation{}, "", apis.NewApiError(
			http.StatusInternalServerError, "Failed to verify organisation access", err)
	}
	if !active {
		return organisations.Organisation{}, "", apis.NewNotFoundError("Organisation not found", nil)
	}

	return organisations.Organisation{
		ID:      record.Id,
		Name:    record.GetString("name"),
		OwnerID: record.GetString("owner"),
		Created: record.GetString("created"),
		Updated: record.GetString("updated"),
	}, role, nil
}

// organisationWriteError maps a repo write failure to an HTTP error: schema
// validation failures (e.g. an overlong name — PocketBase surfaces them as
// ozzo validation.Errors) are the caller's fault and get 400; anything else
// (transaction/database/internal failures) defaults to 500 so internal
// errors never masquerade as client mistakes.
func organisationWriteError(message string, err error) error {
	var validationErrs validation.Errors
	if errors.As(err, &validationErrs) {
		return apis.NewBadRequestError(message, err)
	}
	return apis.NewApiError(http.StatusInternalServerError, message, err)
}

// organisationNameFromBody parses and trims the request's name field,
// rejecting empty (or whitespace-only) names before they hit the schema.
func organisationNameFromBody(e *core.RequestEvent) (string, error) {
	var req upsertOrganisationRequest
	if err := e.BindBody(&req); err != nil {
		return "", apis.NewBadRequestError("Failed to read request data", err)
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return "", apis.NewBadRequestError("Organisation name is required", nil)
	}
	return name, nil
}

func organisationToResponse(
	org organisations.Organisation,
	callerRole organisations.Role,
) organisationResponse {
	return organisationResponse{
		ID:         org.ID,
		Name:       org.Name,
		Owner:      org.OwnerID,
		CallerRole: string(callerRole),
		Created:    org.Created,
		Updated:    org.Updated,
	}
}
