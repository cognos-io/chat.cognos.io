package handler

import (
	"encoding/csv"
	"fmt"
	"math"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
)

// Organisation audit log handlers (/api/v1/orgs/{orgID}/audit). The log is
// content-free by construction (see organisations.RecordAudit): every row is
// action + opaque target id, so exposing it to owners/admins never reveals
// message content, conversation titles or invite emails.

const orgAuditMaxPageSize = 100

type orgAuditEventResponse struct {
	ID      string `json:"id"`
	Action  string `json:"action"`
	Actor   string `json:"actor"`
	Target  string `json:"target,omitempty"`
	Created string `json:"created"`
}

type listOrgAuditEventsResponse struct {
	Page       int                     `json:"page"`
	PerPage    int                     `json:"perPage"`
	TotalItems int64                   `json:"totalItems"`
	TotalPages int                     `json:"totalPages"`
	Items      []orgAuditEventResponse `json:"items"`
}

// OrgAuditList returns the organisation's audit events, newest first, using
// the house ?page/?page_size pagination. Owner/admin only; plain members get
// 403 and non-members the usual neutral 404.
func OrgAuditList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		org, role, err := memberOrganisationOr404(app, e)
		if err != nil {
			return err
		}
		if !role.CanManage() {
			return apis.NewForbiddenError("Only organisation owners and admins can view the audit log", nil)
		}

		query := e.Request.URL.Query()
		page := parsePositiveIntOrDefault(query.Get("page"), 1)
		perPage := parsePositiveIntOrDefault(query.Get("page_size"), orgAuditMaxPageSize)
		if perPage > orgAuditMaxPageSize {
			perPage = orgAuditMaxPageSize
		}
		offset := (page - 1) * perPage

		var totalItems int64
		if err := app.DB().
			Select("COUNT(*)").
			From(organisations.AuditCollectionName).
			Where(dbx.HashExp{"organisation": org.ID}).
			Row(&totalItems); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to count audit events", err)
		}

		records, err := app.FindRecordsByFilter(
			organisations.AuditCollectionName,
			"organisation = {:org}",
			"-created", perPage, offset,
			dbx.Params{"org": org.ID},
		)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list audit events", err)
		}

		items := make([]orgAuditEventResponse, 0, len(records))
		for _, r := range records {
			items = append(items, orgAuditEventResponse{
				ID:      r.Id,
				Action:  r.GetString("action"),
				Actor:   r.GetString("actor"),
				Target:  r.GetString("target"),
				Created: r.GetString("created"),
			})
		}

		return e.JSON(http.StatusOK, listOrgAuditEventsResponse{
			Page:       page,
			PerPage:    perPage,
			TotalItems: totalItems,
			TotalPages: int(math.Ceil(float64(totalItems) / float64(perPage))),
			Items:      items,
		})
	}
}

// OrgAuditExport streams the full audit log as a CSV attachment
// (created,action,actor,target — the same content-free columns the list
// endpoint returns). Owner/admin only.
func OrgAuditExport(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		org, role, err := memberOrganisationOr404(app, e)
		if err != nil {
			return err
		}
		if !role.CanManage() {
			return apis.NewForbiddenError("Only organisation owners and admins can export the audit log", nil)
		}

		records, err := app.FindRecordsByFilter(
			organisations.AuditCollectionName,
			"organisation = {:org}",
			"-created", 0, 0,
			dbx.Params{"org": org.ID},
		)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load audit events", err)
		}

		e.Response.Header().Set("Content-Type", "text/csv; charset=utf-8")
		e.Response.Header().Set(
			"Content-Disposition",
			fmt.Sprintf("attachment; filename=%q", "org-audit-"+org.ID+".csv"),
		)
		e.Response.WriteHeader(http.StatusOK)

		writer := csv.NewWriter(e.Response)
		if err := writer.Write([]string{"created", "action", "actor", "target"}); err != nil {
			return err
		}
		for _, r := range records {
			if err := writer.Write([]string{
				r.GetString("created"),
				r.GetString("action"),
				r.GetString("actor"),
				r.GetString("target"),
			}); err != nil {
				return err
			}
		}
		writer.Flush()
		return writer.Error()
	}
}
