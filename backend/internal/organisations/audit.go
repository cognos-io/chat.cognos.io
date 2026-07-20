package organisations

import (
	"github.com/pocketbase/pocketbase/core"
)

// AuditCollectionName is the content-free organisation audit log collection
// (docs/specs/organisations.md §11 Phase 2). Rows record administrative
// events only — membership, invites, policies, billing, sharing — never
// message content, conversation titles or invite emails.
const AuditCollectionName = "org_audit_events"

// Dot-namespaced audit actions. The action names are part of the export
// contract (CSV rows admins download) — treat renames as breaking changes.
const (
	AuditInviteCreated             = "org.invite.created"
	AuditInviteRevoked             = "org.invite.revoked"
	AuditInviteAccepted            = "org.invite.accepted"
	AuditMemberOffboarded          = "org.member.offboarded"
	AuditMemberSessionsRevoked     = "org.member.sessions_revoked"
	AuditPoliciesUpdated           = "org.policies.updated"
	AuditBillingCheckoutStarted    = "org.billing.checkout_started"
	AuditProjectParticipantAdded   = "org.project.participant_added"
	AuditProjectParticipantRevoked = "org.project.participant_revoked"
	AuditProjectRotated            = "org.project.rotated"
	AuditOrganisationDissolved     = "org.dissolved"
)

// RecordAudit appends one content-free audit event. target must be an OPAQUE
// record id (invite row id, user id, "projectID:userID") — callers must never
// pass emails, names, titles or key material; a pin test regexes stored
// targets to keep this honest.
//
// Recording is best-effort: the audit trail must never fail (or roll back)
// the mutation it describes, so failures are logged and swallowed. Call it
// after the mutation has committed.
func RecordAudit(app core.App, orgID, actorID, action, target string) {
	collection, err := app.FindCollectionByNameOrId(AuditCollectionName)
	if err != nil {
		app.Logger().Error("org audit collection unavailable", "err", err, "action", action)
		return
	}

	record := core.NewRecord(collection)
	record.Set("organisation", orgID)
	record.Set("actor", actorID)
	record.Set("action", action)
	record.Set("target", target)

	if err := app.Save(record); err != nil {
		app.Logger().Error("org audit event write failed", "err", err, "action", action, "org_id", orgID)
	}
}
