package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/billing"
	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
	"github.com/cognos-io/chat.cognos.io/backend/internal/paddle"
	validation "github.com/go-ozzo/ozzo-validation/v4"
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
	// Policy fields are readable by every member; writable via
	// PATCH /orgs/{id}/policies by owners/admins only.
	PolicyPrivacyTier   string `json:"policy_privacy_tier,omitempty"`
	PolicyRetentionDays int    `json:"policy_retention_days,omitempty"`
	PolicyMFARequired   bool   `json:"policy_mfa_required,omitempty"`
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

// ---------------------------------------------------------------------------
// Org billing (checkout, status, portal, usage)
// ---------------------------------------------------------------------------

type OrganisationBillingCheckoutParams struct {
	Logger  *slog.Logger
	Client  paddle.Client
	PriceID string
	App     core.App
}

type OrganisationBillingGetParams struct {
	Logger          *slog.Logger
	MinCommitRappen int64
	App             core.App
}

type OrganisationBillingPortalParams struct {
	Logger *slog.Logger
	Client paddle.Client
	App    core.App
}

type OrganisationUsageParams struct {
	Logger *slog.Logger
	App    core.App
}

type orgBillingResponse struct {
	PlanType               billing.PlanType `json:"plan_type"`
	PastDue                bool             `json:"past_due"`
	SeatQuantity           int64            `json:"seat_quantity"`
	PendingSeatQuantity    int64            `json:"pending_seat_quantity"`
	CycleStartAt           string           `json:"cycle_start_at,omitempty"`
	CycleEndAt             string           `json:"cycle_end_at,omitempty"`
	FloorRappen            int64            `json:"floor_rappen"`
	PooledUsageRappen      int64            `json:"pooled_usage_rappen"`
	ProjectedOverageRappen int64            `json:"projected_overage_rappen"`
}

type orgUsageMember struct {
	User        string   `json:"user"`
	DisplayName string   `json:"display_name"`
	CostRappen  int64    `json:"cost_rappen"`
	Completions int64    `json:"completions"`
	TopModels   []string `json:"top_models"`
}

type orgUsageResponse struct {
	CycleStartAt string           `json:"cycle_start_at"`
	CycleEndAt   string           `json:"cycle_end_at"`
	TotalRappen  int64            `json:"total_rappen"`
	Members      []orgUsageMember `json:"members"`
}

// OrganisationBillingCheckout creates a Paddle hosted checkout for a single
// org seat. Quantity is always 1; custom_data carries org_id so the webhook
// can route the subscription to the correct Organisation.
func OrganisationBillingCheckout(params OrganisationBillingCheckoutParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		org, role, err := memberOrganisationOr404(params.App, e)
		if err != nil {
			return err
		}
		if role != organisations.RoleOwner {
			return apis.NewForbiddenError("Only the organisation owner can manage billing", nil)
		}

		if params.Client == nil || params.PriceID == "" {
			return apis.NewApiError(http.StatusServiceUnavailable, "Billing is not configured", nil)
		}

		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		customerID := orgCustomerID(params.App, org.ID)

		result, err := params.Client.CreateCheckout(e.Request.Context(), paddle.CheckoutRequest{
			PriceID:    params.PriceID,
			UserID:     user.ID,
			CustomerID: customerID,
			OrgID:      org.ID,
			Quantity:   1,
		})
		if err != nil {
			if params.Logger != nil {
				params.Logger.Error("paddle org checkout failed", "err", err, "org_id", org.ID)
			}
			return apis.NewApiError(http.StatusBadGateway, "Failed to start checkout", nil)
		}

		if result.CustomerID != "" {
			if orgRec, err := params.App.FindRecordById("organisations", org.ID); err == nil && orgRec != nil {
				if orgRec.GetString("paddle_customer_id") != result.CustomerID {
					orgRec.Set("paddle_customer_id", result.CustomerID)
					if err := params.App.Save(orgRec); err != nil && params.Logger != nil {
						params.Logger.Error("failed to persist paddle_customer_id on org", "err", err)
					}
				}
			}
		}

		// Target is the opaque Paddle transaction id — useful for billing
		// reconciliation, never content.
		organisations.RecordAudit(
			params.App, org.ID, user.ID,
			organisations.AuditBillingCheckoutStarted, result.TransactionID,
		)

		return e.JSON(http.StatusOK, map[string]string{
			"checkout_url": result.CheckoutURL,
		})
	}
}

// OrganisationBillingGet returns the Organisation's current billing snapshot:
// plan, seat count, cycle window, and pooled PAYG usage so far. All amounts
// are in whole rappen — the internal micro-rappen precision is never leaked.
func OrganisationBillingGet(params OrganisationBillingGetParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		org, role, err := memberOrganisationOr404(params.App, e)
		if err != nil {
			return err
		}
		if !role.CanManage() {
			return apis.NewForbiddenError("Only organisation owners and admins can view billing", nil)
		}

		record, err := params.App.FindFirstRecordByData("org_billing", "organisation", org.ID)
		if err != nil || record == nil {
			return e.JSON(http.StatusOK, orgBillingResponse{
				PlanType: billing.PlanTypeInactive,
			})
		}

		planType := billing.PlanType(record.GetString("plan_type"))
		seatQty := int64(record.GetInt("seat_quantity"))
		pendingQty := int64(record.GetInt("pending_seat_quantity"))
		pastDue := record.GetBool("past_due")

		cycleStart := record.GetDateTime("paddle_cycle_start_at").Time().UTC()
		cycleEnd := record.GetDateTime("paddle_cycle_end_at").Time().UTC()

		commit := params.MinCommitRappen
		if commit <= 0 {
			commit = billing.DefaultPAYGMinCommitRappen
		}

		var pooledUsageRappen int64
		if !cycleStart.IsZero() && !cycleEnd.IsZero() {
			usageMicro, err := sumOrgPAYGUsageMicro(params.App, org.ID, cycleStart, cycleEnd)
			if err != nil {
				if params.Logger != nil {
					params.Logger.Error("org usage lookup failed", "err", err, "org_id", org.ID)
				}
				return apis.NewApiError(http.StatusInternalServerError, "Failed to load usage", err)
			}
			pooledUsageRappen = billing.CeilRappenFromMicro(usageMicro)
		}

		summary := billing.ComputeOrgCycleSummary(pooledUsageRappen, seatQty, commit)

		return e.JSON(http.StatusOK, orgBillingResponse{
			PlanType:               planType,
			PastDue:                pastDue,
			SeatQuantity:           seatQty,
			PendingSeatQuantity:    pendingQty,
			CycleStartAt:           formatBillingTime(cycleStart),
			CycleEndAt:             formatBillingTime(cycleEnd),
			FloorRappen:            summary.SeatQuantity * commit,
			PooledUsageRappen:      summary.PooledUsageRappen,
			ProjectedOverageRappen: summary.OverageChargeRappen,
		})
	}
}

// OrganisationBillingPortal mints an authenticated Paddle customer-portal link
// for the Organisation's owner.
func OrganisationBillingPortal(params OrganisationBillingPortalParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		org, role, err := memberOrganisationOr404(params.App, e)
		if err != nil {
			return err
		}
		if role != organisations.RoleOwner {
			return apis.NewForbiddenError("Only the organisation owner can manage billing", nil)
		}

		if params.Client == nil {
			return apis.NewApiError(http.StatusServiceUnavailable, "Billing is not configured", nil)
		}

		customerID := orgCustomerID(params.App, org.ID)
		if customerID == "" {
			return apis.NewApiError(http.StatusConflict, "No billing account yet", nil)
		}

		var subscriptionIDs []string
		if rec, err := params.App.FindFirstRecordByData("org_billing", "organisation", org.ID); err == nil && rec != nil {
			if subID := rec.GetString("paddle_subscription_id"); subID != "" {
				subscriptionIDs = []string{subID}
			}
		}

		session, err := params.Client.CreatePortalSession(
			e.Request.Context(), customerID, subscriptionIDs,
		)
		if err != nil {
			if params.Logger != nil {
				params.Logger.Error("paddle org portal session failed", "err", err, "org_id", org.ID)
			}
			return apis.NewApiError(http.StatusBadGateway, "Failed to open billing portal", nil)
		}

		return e.JSON(http.StatusOK, map[string]string{
			"portal_url": session.OverviewURL,
		})
	}
}

// OrganisationUsage returns per-member usage metadata for the current billing
// cycle. It aggregates only ledger metadata (model ids, counts, cost) — never
// conversation content — so it is safe despite end-to-end encryption.
func OrganisationUsage(params OrganisationUsageParams) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		org, role, err := memberOrganisationOr404(params.App, e)
		if err != nil {
			return err
		}
		if !role.CanManage() {
			return apis.NewForbiddenError("Only organisation owners and admins can view usage", nil)
		}

		record, err := params.App.FindFirstRecordByData("org_billing", "organisation", org.ID)
		if err != nil || record == nil {
			return e.JSON(http.StatusOK, orgUsageResponse{})
		}

		cycleStart := record.GetDateTime("paddle_cycle_start_at").Time().UTC()
		cycleEnd := record.GetDateTime("paddle_cycle_end_at").Time().UTC()
		if cycleStart.IsZero() || cycleEnd.IsZero() {
			return e.JSON(http.StatusOK, orgUsageResponse{})
		}

		members, totalRappen, err := orgUsageSince(params.App, org.ID, cycleStart, cycleEnd)
		if err != nil {
			if params.Logger != nil {
				params.Logger.Error("org usage aggregation failed", "err", err, "org_id", org.ID)
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load usage", err)
		}

		return e.JSON(http.StatusOK, orgUsageResponse{
			CycleStartAt: cycleStart.Format(time.RFC3339),
			CycleEndAt:   cycleEnd.Format(time.RFC3339),
			TotalRappen:  totalRappen,
			Members:      members,
		})
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// orgCustomerID resolves the organisation's Paddle customer id. It prefers the
// id persisted on the organisations record, falling back to the org_billing row.
func orgCustomerID(app core.App, orgID string) string {
	if org, err := app.FindRecordById("organisations", orgID); err == nil && org != nil {
		if id := org.GetString("paddle_customer_id"); id != "" {
			return id
		}
	}
	if rec, err := app.FindFirstRecordByData("org_billing", "organisation", orgID); err == nil && rec != nil {
		if id := rec.GetString("paddle_customer_id"); id != "" {
			return id
		}
	}
	return ""
}

// orgUsageSince aggregates per-member usage metadata from org-attributed ledger
// rows in the half-open cycle window [start, end). top_models contains up to
// three model ids ordered by spend desc.
func orgUsageSince(app core.App, orgID string, start, end time.Time) ([]orgUsageMember, int64, error) {
	type row struct {
		UserID      string `db:"user_id"`
		DisplayName string `db:"display_name"`
		ModelID     string `db:"model_id"`
		CostMicro   int64  `db:"cost_micro"`
		Completions int64  `db:"completions"`
	}

	var rows []row
	err := app.DB().NewQuery(`
		SELECT
			t.user_id,
			COALESCE(u.display_name, '') AS display_name,
			t.model_id,
			COALESCE(SUM(t.user_cost_microrappen), 0) AS cost_micro,
			COUNT(*) AS completions
		FROM ` + balanceTransactionsColl + ` t
		LEFT JOIN users u ON u.id = t.user_id
		WHERE t.organisation = {:org_id}
		  AND t.type = {:type}
		  AND t.occurred_at >= {:start}
		  AND t.occurred_at < {:end}
		GROUP BY t.user_id, t.model_id
		ORDER BY t.user_id, cost_micro DESC
	`).Bind(dbx.Params{
		"org_id": orgID,
		"type":   billing.UsageTransactionType,
		"start":  start.UTC().Format(webhookPBDateLayout),
		"end":    end.UTC().Format(webhookPBDateLayout),
	}).All(&rows)
	if err != nil {
		return nil, 0, err
	}

	byUser := make(map[string]*orgUsageMember)
	userCostMicro := make(map[string]int64)
	var order []string
	for _, r := range rows {
		m, ok := byUser[r.UserID]
		if !ok {
			m = &orgUsageMember{
				User:        r.UserID,
				DisplayName: r.DisplayName,
			}
			byUser[r.UserID] = m
			order = append(order, r.UserID)
		}
		userCostMicro[r.UserID] += r.CostMicro
		m.Completions += r.Completions
		if len(m.TopModels) < 3 {
			m.TopModels = append(m.TopModels, r.ModelID)
		}
	}

	members := make([]orgUsageMember, 0, len(order))
	var total int64
	for _, uid := range order {
		m := *byUser[uid]
		m.CostRappen = billing.CeilRappenFromMicro(userCostMicro[uid])
		members = append(members, m)
		total += m.CostRappen
	}
	return members, total, nil
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
		ID:                  record.Id,
		Name:                record.GetString("name"),
		OwnerID:             record.GetString("owner"),
		Created:             record.GetString("created"),
		Updated:             record.GetString("updated"),
		PolicyPrivacyTier:   record.GetString("policy_privacy_tier"),
		PolicyRetentionDays: record.GetInt("policy_retention_days"),
		PolicyMFARequired:   record.GetBool("policy_mfa_required"),
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
		ID:                  org.ID,
		Name:                org.Name,
		Owner:               org.OwnerID,
		CallerRole:          string(callerRole),
		Created:             org.Created,
		Updated:             org.Updated,
		PolicyPrivacyTier:   org.PolicyPrivacyTier,
		PolicyRetentionDays: org.PolicyRetentionDays,
		PolicyMFARequired:   org.PolicyMFARequired,
	}
}
