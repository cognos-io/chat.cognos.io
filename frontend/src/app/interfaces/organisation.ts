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

// --- Org billing & usage (spec §5.6–5.8, §7) --------------------------------

/**
 * Org billing plan state. 'inactive' covers both a fresh Organisation whose
 * checkout never completed and a lapsed subscription — either way org Projects
 * are read-only and completions are refused (fail closed, spec §5.8).
 */
export type OrgPlanState = 'payg' | 'inactive';

/** OrgBillingRecord is GET /api/v1/orgs/{id}/billing (Owner/Admin only). */
export interface OrgBillingRecord {
  plan_type: OrgPlanState;
  past_due: boolean;
  /** Seats billed this cycle. */
  seat_quantity: number;
  /** Seats billed next cycle — lower than seat_quantity after an offboard. */
  pending_seat_quantity: number;
  cycle_start_at: string;
  cycle_end_at: string;
  /** The pooled monthly floor: N seats × CHF 15, in rappen. */
  floor_rappen: number;
  /** Pooled usage across all members so far this cycle, in rappen. */
  pooled_usage_rappen: number;
  /** Overage projected at cycle close: max(0, usage − floor), in rappen. */
  projected_overage_rappen: number;
}

/**
 * One member's row of the org usage dashboard. Metadata ONLY — cost, counts
 * and model mix; never message content, Conversation titles or Project names
 * (spec §5.6 / security-model hard line).
 */
export interface OrgMemberUsageRecord {
  user: string;
  display_name?: string;
  cost_rappen: number;
  completions: number;
  top_models: string[];
}

/** OrgUsageRecord is GET /api/v1/orgs/{id}/usage (Owner/Admin only). */
export interface OrgUsageRecord {
  cycle_start_at: string;
  cycle_end_at: string;
  members: OrgMemberUsageRecord[];
  total_rappen: number;
}

// --- Invites (spec §5.5, §8.1) ----------------------------------------------

/** Roles an invite can grant — Ownership is never granted by invite. */
export type OrgInviteRole = 'admin' | 'member';

/**
 * One pending invite of GET /api/v1/orgs/{id}/invites. Never carries the
 * token value — the server stores only its hash.
 */
export interface OrgInviteRecord {
  id: string;
  /** Optional reference address; '' for a bare link invite. */
  invited_email: string;
  role: OrgInviteRole;
  expires_at: string;
}

/**
 * POST /api/v1/orgs/{id}/invites response. The single-use token is returned
 * exactly once, here — it can never be fetched again.
 */
export interface OrgInviteCreatedRecord extends OrgInviteRecord {
  token: string;
}

/**
 * POST /api/v1/org-invites/accept response: the joined Organisation's id and
 * the role granted. Idempotent for an already-active member (returns their
 * current role); unknown/expired/consumed tokens get a neutral 404 instead.
 */
export interface OrgInviteAcceptResponse {
  organisation: string;
  role: OrgRole;
}

/**
 * GET /api/v1/users/{userId}/public-key response. Relationship-gated: only
 * resolvable for yourself, or by an Owner/Admin of an Organisation the target
 * is an active member of (the project-sharing wrap step, spec §8.1/§9).
 */
export interface UserPublicKeyResponse {
  public_key: string;
}

/** POST /api/v1/orgs/{id}/billing/checkout response. */
export interface OrgCheckoutResponse {
  checkout_url: string;
}

/** GET /api/v1/orgs/{id}/billing/portal response (Owner only). */
export interface OrgPortalResponse {
  portal_url: string;
}
