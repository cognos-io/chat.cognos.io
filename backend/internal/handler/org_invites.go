package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/cognos-io/chat.cognos.io/backend/internal/auth"
	"github.com/cognos-io/chat.cognos.io/backend/internal/organisations"
)

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

type createOrgInviteRequest struct {
	Email      string   `json:"email"`
	Role       string   `json:"role"`
	ProjectIDs []string `json:"project_ids,omitempty"`
}

type orgInviteResponse struct {
	ID           string   `json:"id"`
	Organisation string   `json:"organisation"`
	InvitedEmail string   `json:"invited_email,omitempty"`
	Role         string   `json:"role"`
	Token        string   `json:"token,omitempty"`
	ExpiresAt    string   `json:"expires_at"`
	ProjectIDs   []string `json:"project_ids,omitempty"`
}

type acceptOrgInviteRequest struct {
	Token string `json:"token"`
}

type acceptOrgInviteResponse struct {
	Organisation string `json:"organisation"`
	Role         string `json:"role"`
}

type userPublicKeyResponse struct {
	PublicKey string `json:"public_key"`
}

// ---------------------------------------------------------------------------
// Create invite
// ---------------------------------------------------------------------------

func OrgInvitesCreate(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		org, role, err := memberOrganisationOr404(app, e)
		if err != nil {
			return err
		}
		if !role.CanManage() {
			return apis.NewForbiddenError("Only owners and admins can invite members.", nil)
		}

		var req createOrgInviteRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Invalid request body.", err)
		}
		req.Role = normaliseRole(req.Role)

		if req.Role != string(organisations.RoleMember) && req.Role != string(organisations.RoleAdmin) {
			return apis.NewBadRequestError("Role must be member or admin.", nil)
		}

		collection, err := app.FindCollectionByNameOrId("org_invites")
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to load collection.", err)
		}

		existing, _ := app.FindRecordsByFilter(
			"org_invites",
			"organisation = {:org} && invited_email = {:email} && consumed_at = ''",
			"", 0, 0,
			dbx.Params{"org": org.ID, "email": req.Email},
		)
		for _, r := range existing {
			_ = app.Delete(r)
		}

		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to generate token.", err)
		}
		token := hex.EncodeToString(tokenBytes)
		hash := sha256.Sum256([]byte(token))
		tokenHash := hex.EncodeToString(hash[:])

		record := core.NewRecord(collection)
		record.Set("organisation", org.ID)
		record.Set("invited_email", req.Email)
		record.Set("role", req.Role)
		record.Set("token_hash", tokenHash)
		record.Set("expires_at", time.Now().UTC().Add(14*24*time.Hour))
		if len(req.ProjectIDs) > 0 {
			raw, _ := json.Marshal(req.ProjectIDs)
			record.Set("project_ids", string(raw))
		}

		if err := app.Save(record); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to save invite.", err)
		}

		// Audit target is the invite ROW id — never the invited email.
		organisations.RecordAudit(app, org.ID, user.ID, organisations.AuditInviteCreated, record.Id)

		return e.JSON(http.StatusCreated, orgInviteResponse{
			ID:           record.Id,
			Organisation: org.ID,
			InvitedEmail: req.Email,
			Role:         req.Role,
			Token:        token,
			ExpiresAt:    record.GetDateTime("expires_at").Time().Format(time.RFC3339),
			ProjectIDs:   req.ProjectIDs,
		})
	}
}

// ---------------------------------------------------------------------------
// List invites
// ---------------------------------------------------------------------------

func OrgInvitesList(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		org, role, err := memberOrganisationOr404(app, e)
		if err != nil {
			return err
		}
		if !role.CanManage() {
			return apis.NewForbiddenError("Only owners and admins can list invites.", nil)
		}

		records, err := app.FindRecordsByFilter(
			"org_invites",
			"organisation = {:org} && consumed_at = ''",
			"created", 0, 0,
			dbx.Params{"org": org.ID},
		)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to list invites.", err)
		}

		response := make([]orgInviteResponse, 0, len(records))
		for _, r := range records {
			var projectIDs []string
			if raw := r.GetString("project_ids"); raw != "" {
				_ = json.Unmarshal([]byte(raw), &projectIDs)
			}
			response = append(response, orgInviteResponse{
				ID:           r.Id,
				Organisation: r.GetString("organisation"),
				InvitedEmail: r.GetString("invited_email"),
				Role:         r.GetString("role"),
				ExpiresAt:    r.GetDateTime("expires_at").Time().Format(time.RFC3339),
				ProjectIDs:   projectIDs,
			})
		}

		return e.JSON(http.StatusOK, response)
	}
}

// ---------------------------------------------------------------------------
// Revoke invite
// ---------------------------------------------------------------------------

func OrgInvitesRevoke(app core.App) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		org, role, err := memberOrganisationOr404(app, e)
		if err != nil {
			return err
		}
		if !role.CanManage() {
			return apis.NewForbiddenError("Only owners and admins can revoke invites.", nil)
		}

		inviteID := e.Request.PathValue("inviteID")
		if inviteID == "" {
			return apis.NewNotFoundError("Invite not found.", nil)
		}

		invite, err := app.FindRecordById("org_invites", inviteID)
		if err != nil || invite.GetString("organisation") != org.ID {
			return apis.NewNotFoundError("Invite not found.", nil)
		}

		if err := app.Delete(invite); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to revoke invite.", err)
		}

		organisations.RecordAudit(app, org.ID, user.ID, organisations.AuditInviteRevoked, inviteID)

		return e.NoContent(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Accept invite
// ---------------------------------------------------------------------------

func OrgInvitesAccept(app core.App, orgRepo organisations.Repo) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user := auth.ExtractUser(e)
		if user == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		var req acceptOrgInviteRequest
		if err := e.BindBody(&req); err != nil {
			return apis.NewBadRequestError("Invalid request body.", err)
		}
		if req.Token == "" {
			return apis.NewNotFoundError("Invite not found.", nil)
		}

		hash := sha256.Sum256([]byte(req.Token))
		tokenHash := hex.EncodeToString(hash[:])

		invite, err := app.FindFirstRecordByFilter(
			"org_invites",
			"token_hash = {:hash}",
			dbx.Params{"hash": tokenHash},
		)
		if err != nil || invite == nil {
			return apis.NewNotFoundError("Invite not found.", nil)
		}

		if !invite.GetDateTime("consumed_at").IsZero() {
			return apis.NewNotFoundError("Invite not found.", nil)
		}
		if invite.GetDateTime("expires_at").Time().Before(time.Now().UTC()) {
			return apis.NewNotFoundError("Invite not found.", nil)
		}

		orgID := invite.GetString("organisation")

		if isMember, _ := orgRepo.IsActiveMember(orgID, user.ID); isMember {
			existingRole, _, _ := orgRepo.ActiveRole(orgID, user.ID)
			return e.JSON(http.StatusOK, acceptOrgInviteResponse{
				Organisation: orgID,
				Role:         string(existingRole),
			})
		}

		role, err := orgRepo.ReactivateOrCreateMembership(orgID, user.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to accept invite.", err)
		}

		invite.Set("consumed_at", time.Now().UTC())
		invite.Set("consumed_by", user.ID)
		if err := app.Save(invite); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to update invite.", err)
		}

		organisations.RecordAudit(app, orgID, user.ID, organisations.AuditInviteAccepted, invite.Id)

		return e.JSON(http.StatusOK, acceptOrgInviteResponse{
			Organisation: orgID,
			Role:         string(role),
		})
	}
}

// ---------------------------------------------------------------------------
// Offboard member
// ---------------------------------------------------------------------------

func OrgMembersOffboard(app core.App, orgRepo organisations.Repo) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		org, callerRole, err := memberOrganisationOr404(app, e)
		if err != nil {
			return err
		}
		if !callerRole.CanManage() {
			return apis.NewForbiddenError("Only owners and admins can offboard members.", nil)
		}

		targetUserID := e.Request.PathValue("userID")
		if targetUserID == "" {
			return apis.NewNotFoundError("Member not found.", nil)
		}

		if targetUserID == caller.ID && callerRole == organisations.RoleOwner {
			return apis.NewBadRequestError("Owners cannot offboard themselves.", nil)
		}

		targetRole, targetActive, err := orgRepo.ActiveRole(org.ID, targetUserID)
		if err != nil {
			return apis.NewNotFoundError("Member not found.", nil)
		}
		if !targetActive {
			return apis.NewNotFoundError("Member not found.", nil)
		}
		if callerRole == organisations.RoleAdmin && targetRole == organisations.RoleOwner {
			return apis.NewForbiddenError("Admins cannot offboard the organisation owner.", nil)
		}

		projectIDs, err := orgRepo.OrgProjectIDs(org.ID)
		if err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to resolve projects.", err)
		}

		if err := app.RunInTransaction(func(txApp core.App) error {
			membership, err := txApp.FindFirstRecordByFilter(
				"org_memberships",
				"organisation = {:org} && user = {:user} && removed_at = ''",
				dbx.Params{"org": org.ID, "user": targetUserID},
			)
			if err != nil || membership == nil {
				return errors.New("membership not found")
			}
			membership.Set("removed_at", time.Now().UTC())
			if err := txApp.Save(membership); err != nil {
				return err
			}

			for _, pid := range projectIDs {
				participant, err := txApp.FindFirstRecordByFilter(
					"project_participants",
					"project = {:project} && user = {:user} && removed_at = ''",
					dbx.Params{"project": pid, "user": targetUserID},
				)
				if err == nil && participant != nil {
					participant.Set("removed_at", time.Now().UTC())
					_ = txApp.Save(participant)
				}
			}

			billing, err := txApp.FindFirstRecordByFilter(
				"org_billing",
				"organisation = {:org}",
				dbx.Params{"org": org.ID},
			)
			if err == nil && billing != nil {
				pending := billing.GetInt("pending_seat_quantity")
				if pending > 1 {
					billing.Set("pending_seat_quantity", pending-1)
					if err := txApp.Save(billing); err != nil {
						return err
					}
				}
			}

			return nil
		}); err != nil {
			return apis.NewApiError(http.StatusInternalServerError, "Failed to offboard member.", err)
		}

		organisations.RecordAudit(app, org.ID, caller.ID, organisations.AuditMemberOffboarded, targetUserID)

		return e.NoContent(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Public key
// ---------------------------------------------------------------------------

func UserPublicKey(app core.App, keyRepo auth.KeyPairRepo, orgRepo organisations.Repo) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		caller := auth.ExtractUser(e)
		if caller == nil {
			return apis.NewUnauthorizedError("User not authenticated", nil)
		}

		targetUserID := e.Request.PathValue("userID")
		if targetUserID == "" {
			return apis.NewNotFoundError("User not found.", nil)
		}

		allowed := false
		if caller.ID == targetUserID {
			allowed = true
		} else {
			callerOrgs, err := orgRepo.GetForUser(caller.ID)
			if err != nil {
				return apis.NewApiError(http.StatusInternalServerError, "Failed to resolve organisations.", err)
			}
			for _, o := range callerOrgs {
				if !o.Role.CanManage() {
					continue
				}
				if isMember, _ := orgRepo.IsActiveMember(o.ID, targetUserID); isMember {
					allowed = true
					break
				}
			}
		}

		if !allowed {
			return apis.NewNotFoundError("User not found.", nil)
		}

		pubKeyBytes, err := keyRepo.UserPublicKey(targetUserID)
		if err != nil {
			if errors.Is(err, auth.ErrNoKeyPair) {
				return apis.NewNotFoundError("User not found.", nil)
			}
			return apis.NewApiError(http.StatusInternalServerError, "Failed to resolve public key.", err)
		}

		return e.JSON(http.StatusOK, userPublicKeyResponse{
			PublicKey: base64.StdEncoding.EncodeToString(pubKeyBytes[:]),
		})
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func normaliseRole(r string) string {
	return strings.ToLower(strings.TrimSpace(r))
}
