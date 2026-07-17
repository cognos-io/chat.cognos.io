// Organisation domain types for the Workspace switcher (docs/specs/organisations.md).
//
// An Organisation is a billing + membership + policy boundary. The caller only
// ever sees Organisations they hold an active Membership in, together with
// their own Org role. Names and metadata here are NOT chat content — they are
// plaintext org records, never encrypted material.

/** Org role of the caller within an Organisation (spec §5.3). */
export type OrgRole = 'owner' | 'admin' | 'member';

/**
 * OrganisationRecord is the API shape of GET /api/v1/orgs list items and
 * GET /api/v1/orgs/{id}: an Organisation the caller is an active member of,
 * with the caller's own role embedded.
 */
export interface OrganisationRecord {
  id: string;
  name: string;
  role: OrgRole;
  created: string;
}

/** OrgMemberRecord is one row of GET /api/v1/orgs/{id}/members. */
export interface OrgMemberRecord {
  user_id: string;
  display_name: string;
  email: string;
  role: OrgRole;
  added_at: string;
}

/**
 * The active Workspace: the caller's personal context, or one Organisation
 * they belong to. Switching Workspace changes billing context, visible
 * Projects and policy — never identity (no re-login, no second unlock).
 */
export type WorkspaceId = 'personal' | string;

export const PERSONAL_WORKSPACE: WorkspaceId = 'personal';
