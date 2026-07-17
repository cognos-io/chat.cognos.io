# Organisations — Teams on Cognos

**Status:** Draft — encodes the founder-approved decision record of 2026-07-17
**Scope:** Product and technical specification
**Related docs:**

- [`CONTEXT.md`](../../CONTEXT.md) — domain glossary
- [`docs/specs/projects.md`](./projects.md) — Project encryption and participant key wrapping
- [`docs/specs/billing.md`](./billing.md) — PAYG ledger, Paddle integration, overage mechanism
- [`docs/security-model.md`](../security-model.md) — trust boundaries and admin-visibility limits

New domain terms introduced by this spec: **Organisation**, **Org membership**, **Seat**,
**Org role**, **org-owned Project**, **Workspace**.

## Table of Contents

1. [Overview](#1-overview)
2. [Target Audience](#2-target-audience)
3. [Problem Statement](#3-problem-statement)
4. [Decisions](#4-decisions)
5. [Core Features](#5-core-features)
6. [Data Model](#6-data-model)
7. [Billing Flows](#7-billing-flows)
8. [Invitation & Offboarding Flows](#8-invitation--offboarding-flows)
9. [Security & Privacy](#9-security--privacy)
10. [Non-Functional Requirements](#10-non-functional-requirements)
11. [Phases](#11-phases)
12. [Success Metrics](#12-success-metrics)
13. [Timeline & Milestones](#13-timeline--milestones)
14. [Risks & Mitigations](#14-risks--mitigations)
15. [Implementation Evidence](#15-implementation-evidence)

## 1. Overview

An **Organisation** is a billing, membership, and policy boundary that lets a company pay for
Cognos once and work together in shared encrypted Projects. It is not a second identity: every
person keeps exactly one Account, one Account Key, and one Vault, and an Account may hold
**Org memberships** in one or more Organisations.

The frontend gains a **Workspace** switcher (Personal ⇄ each Organisation). Switching Workspace
changes billing context, visible Projects, and policy — never identity. There is no re-login, no
second unlock, and no second Emergency Kit.

Organisations own **org-owned Projects**. A Project is either personal (bills the creator's
`user_billing`) or org-owned (bills `org_billing`). Content encryption is unchanged from
[`projects.md`](./projects.md): the project content key is sealed per participant to their Account
public key, and the server never holds a key that opens content. Org admins see **metadata only** —
seats, per-member usage and cost, model mix, and cycle spend — never message content
(see [Section 9](#9-security--privacy)).

Billing is one Paddle subscription per Organisation at **CHF 15.00 per Seat per month** (the PAYG
floor), with **pooled** usage: at cycle close the Organisation owes
`max(0, total org usage − N × CHF 15)` as a single overage charge, reusing the ledger and
one-time-charge machinery from [`billing.md`](./billing.md).

## 2. Target Audience

Primary:

- Small and mid-sized European teams (2–50 people) that want ChatGPT-style collaboration without
  handing readable chat history to a US provider — legal, finance, healthcare-adjacent, agencies.
- The team lead or founder who signs up personally, likes Cognos, and wants to bring colleagues in
  on one invoice.
- Privacy officers and IT admins who need to answer "what can the vendor and our own admins read?"
  with a defensible "usage and cost metadata, never conversations".

Secondary:

- Existing personal Account holders who join an employer's Organisation and expect their personal
  Conversations and Projects to remain private and personally billed.
- Operators who run billing reconciliation and support, who need org and personal subjects to flow
  through the same ledger and webhook machinery.

## 3. Problem Statement

Cognos today bills and organises everything per Account. A team that wants to adopt Cognos must
have each member pay individually, cannot pool a budget, has no shared administrative view, and has
no way to offboard a leaver beyond asking nicely. Shared encrypted Projects exist
([`projects.md`](./projects.md)) but there is no boundary above them: no entity that owns Projects,
carries a company invoice, enforces policy, or guarantees that everyone in a shared Project actually
belongs to the company.

Cost of not solving it:

- Teams evaluate Cognos, hit "every member needs a personal card", and leave for a competitor with
  a team plan.
- Shared Projects between colleagues have no offboarding story — when someone leaves the company,
  nothing revokes their access or rotates keys as a matter of course.
- Revenue stays capped at individual subscriptions; the B2B positioning
  (branch `feat/b2b-positioning`) has no product behind it.

## 4. Decisions

Founder-approved 2026-07-17. These are settled; the rest of this spec encodes them. Do not
re-litigate them in implementation reviews.

| #   | Decision                                                                                                                                                                     | Rationale (one line)                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Identity model**: one Account per person; an Organisation is a context (Workspace), never a second identity                                                                | One Account Key and one Emergency Kit per human — a second identity doubles the loseable secrets and the unlock friction for no security gain.                |
| 2   | **Pooled floor**: cycle overage is `max(0, total usage − N × CHF 15)`, not per-seat floors                                                                                   | Teams have mixed usage; pooling makes light users subsidise heavy ones inside one predictable floor and needs only one overage charge per cycle.              |
| 3   | **Next-cycle seat decrement**: removing a Seat takes effect at the next cycle; no mid-cycle refund                                                                           | The floor is billed in advance per Paddle cycle; decrementing at the boundary avoids refund plumbing and proration disputes.                                  |
| 4   | **No org trial**                                                                                                                                                             | Individuals keep their personal trial for evaluation; design partners get manual Paddle adjustments, so a second trial system buys nothing but abuse surface. |
| 5   | **Owner-is-first-seat**: org creation runs Paddle checkout at quantity 1 with the Owner as the first Seat                                                                    | An Organisation never exists without billing, and the Owner always occupies a paid Seat like everyone else.                                                   |
| 6   | **Participant-must-be-member**: every participant of an org-owned Project must be an active org member (enforced server-side)                                                | Keeps billing attribution and offboarding airtight — revoking a membership provably reaches every org Project.                                                |
| 7   | **Lapse → read-only**: an unresolved canceled/past-due org subscription makes org Projects read-only for all members                                                         | Fail closed on money without destroying data — nothing is deleted, nothing new is spent.                                                                      |
| 8   | **Invite-by-token + direct wrap**: product flow is a single-use token; the crypto step seals the project content key to the invitee's Account public key once they are known | Works for invitees without a Cognos Account and avoids email enumeration, while keeping the shipped per-participant wrapping model intact.                    |
| 9   | **No org root key in v1**: content access stays per-Project via `project_key_wrappings`                                                                                      | The shipped model already gives exactly-right access; an org-wide key is a new blast radius with no v1 use case (revisit for SSO-era v2).                     |

## 5. Core Features

### 5.1 Create an Organisation

- **Description**: Any existing Account can create an Organisation. Creation runs a Paddle checkout
  at quantity 1; the creator becomes Owner and occupies the first Seat. The Organisation has no
  billing (and grants no org capability) until checkout completes.
- **User Story**: As an Account holder whose team wants Cognos, I want to create an Organisation
  and pay on one company invoice so that my colleagues don't each need a card.
- **Priority**: P0
- **Acceptance Criteria**:
    - An authenticated Account can start org creation; the flow collects an Organisation name and
      opens a Paddle checkout at quantity 1 carrying `custom_data.org_id`.
    - On `subscription.created` for the org subject, `org_billing` is populated and the creator's
      membership becomes an active Owner Seat.
    - Until the webhook lands, the Organisation exposes no org Projects and accepts no invites.
    - Abandoned checkouts leave no active Organisation behind.
    - There is no trial step in org creation (decision #4): the first cycle's Seat floor is
      collected at checkout.
    - Existing Accounts are personal-only by default; nothing changes for Accounts that never
      create or join an Organisation.

### 5.2 Workspace switcher

- **Description**: A frontend control that switches the active Workspace between Personal and each
  Organisation the Account belongs to. It changes billing context, visible Projects, and applicable
  policy — not identity.
- **User Story**: As a member of an Organisation, I want to flip between my personal Workspace and
  the company Workspace so that work and private use stay cleanly separated.
- **Priority**: P0
- **Acceptance Criteria**:
    - Switching Workspace requires no re-login, no second unlock, and no additional Emergency Kit.
    - The personal Workspace shows only personal Projects and Conversations; an org Workspace shows
      only that Organisation's Projects.
    - Completions started in an org Project bill `org_billing`; personal ones bill `user_billing`,
      regardless of which Workspace was last viewed — attribution follows Project scope.
    - A draft message in the composer is never lost by switching Workspace.
    - The switcher is keyboard operable, exposed to assistive technology, and translated in all six
      locales.

### 5.3 Org membership and roles

- **Description**: One `org_memberships` row per (organisation, account) with an Org role of
  Owner, Admin, or Member, and soft revocation via `removed_at`. Every active member occupies a
  billed Seat.
- **User Story**: As an Owner, I want to grant a colleague admin rights without giving them billing
  control so that day-to-day member management doesn't require me.
- **Priority**: P0
- **Acceptance Criteria**:
    - Owner: billing management and dissolution, plus everything Admin can do.
    - Admin: manage members, Seats, and policy; view the metadata dashboard (5.6).
    - Member: works in org Projects; no administrative surface.
    - Org Admins are automatically Project Admin on org-owned Projects, enforced in the auth layer
      and not stored redundantly.
    - Revoked memberships keep their row (`removed_at` set) for audit but grant nothing.

### 5.4 Org-owned Projects

- **Description**: Projects gain an optional `organisation` relation. An org-owned Project bills
  `org_billing`, is visible in the org Workspace, and only active org members may be participants.
- **User Story**: As a Member, I want our shared Project's usage to land on the company invoice so
  that I never personally pay for work chats.
- **Priority**: P0
- **Acceptance Criteria**:
    - Participant-add on an org-owned Project rejects any Account that is not an active org member
      (backend validation, decision #6).
    - Encryption is unchanged from [`projects.md`](./projects.md): content key sealed per
      participant; the server holds no content key.
    - Members retain fully personal Projects and Conversations alongside org membership.
    - Cross-user and cross-org access is denied and covered by filter-rule tests
      (`docs/api-permissions.md` checklist).

### 5.5 Invitations

- **Description**: Admins invite people by single-use token. An invite grants Org membership (and
  a Seat) only; Project access is granted per Project by a Project Admin. The flow works for
  addresses with no Cognos Account and never reveals whether an address is registered. See
  [Section 8](#8-invitation--offboarding-flows) for the step-by-step flow.
- **User Story**: As an Admin, I want to invite a colleague by email or link so that they can join
  the Organisation whether or not they already use Cognos.
- **Priority**: P0
- **Acceptance Criteria**:
    - Invites are single-use, expiring tokens; the server stores a hash, never the raw token.
    - API responses are identical whether or not the invited address has an Account
      (enumeration-safe).
    - Accepting an invite creates an active membership and increases the Paddle Seat quantity with
      native proration.
    - An invite grants Org membership and a Seat only. Access to each org Project is granted per
      Project by a Project Admin — least privilege: membership never implies access to every org
      Project. Org Admins retain their implicit Project-Admin authority (5.4).
    - An invite may carry an optional Admin-selected list of org Projects to wrap on accept, so
      onboarding into the day-1 Projects happens in one sitting.
    - Invite acceptance works in one sitting, with no IT or SSO ceremony before the first Seat.
    - Project content access is granted by the direct-wrap step (Section 8), never implied by
      membership alone.

### 5.6 Admin metadata dashboard

- **Description**: A per-Organisation view for Owners and Admins showing exactly: Seats, per-member
  usage and cost, model mix, and cycle spend. Nothing content-derived.
- **User Story**: As an Admin, I want to see who is using what and what the cycle will cost so that
  I can manage budget without ever being able to read anyone's chats.
- **Priority**: P0
- **Acceptance Criteria**:
    - Dashboard shows: active Seats, per-member cost for the cycle, model mix, and current cycle
      spend against the pooled floor.
    - No message content, Conversation titles, Project names, memory, or file names appear in any
      admin API response — the server cannot decrypt them and must not proxy them.
    - Admins see the projected pooled overage for the current cycle before cycle close.
    - Figures reconcile with the `balance_transactions` ledger.
    - All labels translated in six locales; tables accessible.

### 5.7 Pooled billing and Seat management

- **Description**: One Paddle subscription per Organisation, quantity = N active Seats at CHF 15
  each, billed in advance. Pooled overage is charged once at cycle close. Seat adds prorate
  mid-cycle; Seat removals decrement at the next cycle. See [Section 7](#7-billing-flows).
- **User Story**: As an Owner, I want one invoice of `max(N × 15, actual usage)` so that costs are
  predictable at the floor and fair above it.
- **Priority**: P0
- **Acceptance Criteria**:
    - Adding a Seat increases the subscription quantity immediately (Paddle native proration).
    - Removing a Seat schedules a quantity decrement at the next cycle boundary; no mid-cycle
      refund is ever issued.
    - Cycle close posts a single overage charge of `max(0, usage − N × CHF 15)` with a
      deterministic per-cycle idempotency key.
    - There is no org trial (decision #4); design-partner discounts happen as manual Paddle
      adjustments.

### 5.8 Fail-closed billing gate and lapse

- **Description**: Completions resolve their billing subject from Project scope. Org Projects with
  missing, inactive, or past-due org billing are refused with HTTP 402 and never fall back to a
  member's personal balance. Unresolved lapse makes org Projects read-only.
- **User Story**: As a Member, I want to be certain that a company billing problem can never
  silently charge my personal balance.
- **Priority**: P0
- **Acceptance Criteria**:
    - `StateForContext(user, conversation)` returns a personal or org billing subject by Project
      scope (see 7.5).
    - Completion in an org Project with missing/inactive/past-due `org_billing` → 402; the member's
      personal balance is never touched.
    - On lapse (canceled or past-due unresolved), org Projects become read-only for all members:
      history remains decryptable, writes and completions are refused.
    - Reactivation restores write access with no data migration.
    - Every billing failure surfaces exactly one actionable next step to the person seeing it
      (for example "update the payment method" for the Owner, "ask your Owner to reactivate" for a
      Member).

## 6. Data Model

Field-level sketch, implementation-agnostic (PocketBase collections; no SQL). All collections keep
API rules `nil` — access flows through `/api/v1` handlers only, matching the billing collections.

### 6.1 `organisations`

| Field                 | Type               | Notes                                                                        |
| --------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `id`                  | PK                 |                                                                              |
| `name`                | Text               | Administrative metadata (appears on invoices and the switcher); not content. |
| `owner`               | Relation → users   | The Owner Account.                                                           |
| `created` / `updated` | DateTime           |                                                                              |
| `dissolved_at`        | DateTime, nullable | Soft dissolution marker.                                                     |

### 6.2 `org_memberships`

One row per (organisation, account); unique on that pair.

| Field          | Type                     | Notes                                  |
| -------------- | ------------------------ | -------------------------------------- |
| `id`           | PK                       |                                        |
| `organisation` | Relation → organisations |                                        |
| `user`         | Relation → users         |                                        |
| `role`         | Text                     | `owner` \| `admin` \| `member`.        |
| `added_at`     | DateTime                 |                                        |
| `removed_at`   | DateTime, nullable       | Soft revoke; non-empty means inactive. |

### 6.3 `org_invites`

| Field                         | Type                          | Notes                                                             |
| ----------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| `id`                          | PK                            |                                                                   |
| `organisation`                | Relation → organisations      |                                                                   |
| `created_by`                  | Relation → users              | The inviting Admin/Owner.                                         |
| `token_hash`                  | Text                          | Hash of the single-use token; the raw token is never stored.      |
| `role`                        | Text                          | Role granted on accept (`admin` \| `member`).                     |
| `invited_email`               | Text, nullable                | Delivery only; responses never confirm whether it has an Account. |
| `expires_at`                  | DateTime                      |                                                                   |
| `accepted_at` / `accepted_by` | DateTime / Relation, nullable | Set on accept.                                                    |
| `revoked_at`                  | DateTime, nullable            | Admin cancellation.                                               |

At most one pending invite may exist per (organisation, invited_email); re-inviting reissues and
replaces the token.

### 6.4 `org_billing`

Parallel to `user_billing`; reuses the micro-rappen ledger machinery (22% margin, ceil charges,
floor balances — see [`billing.md`](./billing.md)).

| Field                                                               | Type                     | Notes                                                     |
| ------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------- |
| `id`                                                                | PK                       |                                                           |
| `organisation`                                                      | Relation → organisations | Unique.                                                   |
| `plan_type`                                                         | Text                     | `payg` only in v1.                                        |
| `balance_microrappen`                                               | Integer                  | Micro-rappen, same precision rules as personal billing.   |
| `paddle_customer_id` / `paddle_subscription_id` / `paddle_price_id` | Text                     | Paddle identities.                                        |
| `seat_quantity`                                                     | Integer                  | N active Seats = subscription item quantity.              |
| `pending_seat_quantity`                                             | Integer, nullable        | Decrement to apply at the next cycle boundary.            |
| `paddle_cycle_start_at` / `paddle_cycle_end_at`                     | DateTime                 | Current cycle bounds.                                     |
| `past_due`                                                          | Bool                     | Dunning flag; drives the read-only gate with `plan_type`. |

### 6.5 Ledger org attribution (`balance_transactions`, extend)

Rows keep `user_id` (audit and per-member metadata) and gain org attribution:

| Field          | Type                               | Notes                                                                                    |
| -------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `organisation` | Relation → organisations, nullable | Set when the usage row belongs to an org-owned Project; settlement happens at org level. |

### 6.6 `projects` (extend)

| Field          | Type                               | Notes                                                                                   |
| -------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| `organisation` | Relation → organisations, nullable | Empty = personal Project (bills `user_billing`); set = org-owned (bills `org_billing`). |

### 6.7 `org_cycle_summaries`

One row per closed org cycle, parallel to `payg_cycle_summaries` in [`billing.md`](./billing.md).

| Field                             | Type                     | Notes                                                           |
| --------------------------------- | ------------------------ | --------------------------------------------------------------- |
| `id`                              | PK                       |                                                                 |
| `organisation`                    | Relation → organisations |                                                                 |
| `paddle_subscription_id`          | Text                     |                                                                 |
| `cycle_start_at` / `cycle_end_at` | DateTime                 | Closed cycle bounds.                                            |
| `seat_quantity`                   | Integer                  | N billed Seats for the cycle.                                   |
| `pooled_usage_microrappen`        | Integer                  | Total org-attributed usage in the cycle.                        |
| `overage_charge_rappen`           | Integer                  | `max(0, usage − N × CHF 15)`; 0 if none.                        |
| `reconciled`                      | Bool                     | True when Paddle's billed amount matches the local expectation. |

Webhook handlers gain a **subject discriminator** (user vs org) driven by `custom_data.org_id` on
checkout, alongside the existing `custom_data.user_id` path.

## 7. Billing Flows

The rule: the Organisation pays `max(N × CHF 15, pooled usage)` per cycle, collected by Paddle,
metered by our ledger — the same split of roles as personal PAYG in
[`billing.md`](./billing.md).

### 7.1 Org creation checkout

1. Creator submits the Organisation name; backend creates the provisional `organisations` row and
   opens a Paddle checkout: org Seat price, **quantity = 1**, `custom_data.org_id` set.
2. Paddle fires `subscription.created`; the webhook subject discriminator routes it to the org
   handler.
3. Backend populates `org_billing` (subscription, cycle bounds, `seat_quantity = 1`) and activates
   the creator's Owner membership — the Owner is the first Seat (decision #5).
4. Until step 3 completes the Organisation has no billing and grants no org capability.

### 7.2 Seat add (mid-cycle)

1. An invite is accepted (Section 8) or an Admin re-activates a membership.
2. Backend increases the Paddle subscription item quantity by one.
3. Paddle applies **native proration** for the remainder of the cycle; `seat_quantity` is updated
   from the `subscription.updated` webhook.

### 7.3 Seat remove (next cycle)

1. An Admin revokes a membership (Section 8) or a member leaves.
2. Backend records the decrement in `pending_seat_quantity` — **no mid-cycle refund**
   (decision #3).
3. At the cycle boundary the subscription quantity is lowered; the leaver's Seat was paid to the
   end of the cycle it was removed in.

### 7.4 Pooled cycle close

1. `subscription.updated` signals cycle rollover for the org subscription.
2. Backend sums the cycle's org-attributed `usage` rows:
   `overage = max(0, usage − N × CHF 15)` where N is the cycle's billed Seat quantity.
3. If overage > 0, post **one** one-time charge via the existing overage mechanism (the CHF
   0.01-unit quantity price from [`billing.md`](./billing.md)), with a deterministic per-cycle
   idempotency key.
4. Record an `org_cycle_summaries` row (6.7) and reconcile against Paddle's
   `transaction.completed`, exactly as personal PAYG does.

### 7.5 Fail-closed gate

- `StateForContext(user, conversation)` — the generalisation of the existing `StateForUser` —
  resolves the billing subject from Project scope: org-owned Project → org subject; otherwise
  personal.
- Org subject missing, `inactive`, or `past_due` → the completion returns **HTTP 402**. It never
  silently falls back to the member's personal balance (decision — see 5.8).

### 7.6 Lapse → read-only

- If the org subscription is canceled or dunning fails (`past_due` unresolved), all org Projects go
  **read-only** for every member: reading and decrypting history still works; new messages,
  completions, uploads, and edits are refused.
- Reactivating the subscription restores write access. Nothing is deleted (decision #7).

## 8. Invitation & Offboarding Flows

The rule: membership is granted by token, content access is granted by key wrapping, and both are
revoked together on offboarding. Key mechanics are the shipped per-participant model in
[`projects.md`](./projects.md) — this section does not restate them.

### 8.1 Invitation (token + direct wrap)

1. **Mint** — an Owner/Admin creates an invite (role, optional email for delivery). The server
   generates a single-use token, stores only its hash with an expiry, and returns the invite link
   once.
2. **Deliver** — by email or by the Admin sharing the link. The API responds identically whether or
   not the address already has an Account: no enumeration signal (decision #8).
3. **Accept** — the invitee opens the link, signs in or signs up (still exactly one Account per
   person), and accepts. The server validates the token hash and expiry, creates the active
   `org_memberships` row, marks the invite accepted, and increases the Seat quantity (7.2).
4. **Wrap** — acceptance grants Org membership and a Seat only; access to each org Project is
   granted **per Project by a Project Admin** (least privilege — membership never implies access
   to every org Project; Org Admins carry implicit Project-Admin authority, 5.4). For each granted
   Project, the Admin's client fetches the invitee's Account public key and seals the project
   content key to it — the **direct wrap**. The invite may carry an optional Admin-selected list
   of org Projects, so the wraps for the day-1 Projects happen on accept in one sitting. The
   server stores only the ciphertext wrapper.
   The public-key endpoint (the server-side primitive already exists) is authenticated-only,
   resolves a key solely in the context of a live invite or membership relationship (an Admin
   wrapping for an accepted invitee of their own Organisation, or an existing Project
   relationship), and is rate-limited — never a general user-id → public-key directory.
5. **Result** — membership grants Workspace access and billing attribution; only wrapping grants
   content. The two are deliberately separate steps.

### 8.2 Offboarding (revoke + rotate + decrement)

1. **Revoke membership** — an Owner/Admin sets `removed_at` on the membership. The member
   immediately loses the org Workspace and all org API access.
2. **Revoke participation** — the backend revokes the leaver's participant rows on every org-owned
   Project (participant-must-be-member makes this set complete, decision #6).
3. **Rotate** — an Admin's client performs **forward-only Project key rotation** on each affected
   Project: new content key, new `key_version`, re-wrapped for remaining participants. As
   documented in [`projects.md`](./projects.md), rotation does not re-encrypt historical content —
   product copy must say removal cuts off _future_ content.
4. **Decrement** — the Seat is queued for next-cycle decrement (7.3).
5. **Untouched** — the departed person's personal Account, personal Projects, and personal
   Conversations are entirely unaffected, and the offboarding UI confirms this to the Admin
   explicitly.

### 8.3 Organisation dissolution

Kept v1-simple. Only the Owner can dissolve an Organisation.

1. Dissolution requires every org-owned Project to have been deleted, or the Owner to explicitly
   confirm their deletion within the dissolution flow — org Projects never silently convert to
   personal ones.
2. The Paddle subscription is cancelled; the final cycle closes and settles as normal (7.4).
3. All memberships are soft-revoked (`removed_at`) and `dissolved_at` is set on the Organisation.
4. Ledger and audit rows are retained; members' personal Accounts and personal data are untouched.

## 9. Security & Privacy

The rule, inherited unchanged from [`security-model.md`](../security-model.md): the server
coordinates access and processes plaintext only transiently during completions; it never persists
or decrypts content, and no Organisation feature weakens that.

- **Server never decrypts content.** There is no org root key in v1 (decision #9). Content access
  is exclusively the per-Project `project_key_wrappings` model — content keys sealed client-side to
  each participant's Account public key. Nothing in `organisations`, `org_memberships`, or
  `org_billing` holds or derives key material.
- **Org admins see metadata only.** The complete list of what Owner/Admin surfaces may expose:
  **Seats, per-member usage/cost, model mix, and cycle spend.** Never message content,
  Conversation titles, Project names, memory, file names, or anything content-derived. This is a
  hard security-model line and user-facing copy must state it plainly ("admins see usage and
  costs, never conversations").
- **Enumeration-safe invites.** Invite tokens are single-use, expiring, and stored hashed. Invite
  and accept responses are uniform regardless of whether an email has an Account. The
  client-facing public-key lookup endpoint is authenticated-only, resolves a key solely in the
  context of a live invite or membership relationship (an Admin wrapping for an accepted invitee
  of their own Organisation, or an existing Project relationship), and is rate-limited — it is
  never a general user-id → public-key directory.
- **Fail-closed billing.** Billing problems refuse service (402, read-only) rather than
  mis-attribute spend; an org fault can never charge a member's personal balance.
- **Attribution without content.** Ledger rows carry `user_id` and org attribution for audit and
  the admin dashboard — cost metadata only, consistent with the billing/analytics boundaries in
  the security model.
- **Access control testing.** Every new endpoint follows `docs/api-permissions.md`: authorised
  scope rule, auth-surface guardrail registration, and a cross-user (and cross-org) denial test.
  Non-members receive `404`, not `403`, where `403` would reveal an Organisation or Project
  exists.

## 10. Non-Functional Requirements

### Performance

- Workspace switching is a client-side context change plus scoped list queries — no re-auth, no
  re-unlock, no full reload.
- The billing gate resolves its subject (Project scope → org/personal) with at most one extra
  indexed lookup per completion; no Paddle call is ever on the completion path.
- The admin dashboard aggregates from the ledger with indexed org attribution; it must not scan
  unrelated Accounts' rows.

### Security

- All new collections keep PocketBase API rules `nil`; access only via `/api/v1` handlers.
- Section 9 constraints are enforced by tests: collection lock-down pins, cross-user/cross-org
  denial tests, and log assertions that no content or token plaintext is emitted.
- Webhook handling reuses the HMAC-verified, idempotent `paddle_events` pipeline from
  [`billing.md`](./billing.md); the subject discriminator must not weaken idempotency.

### Scalability

- Designed for teams of 2–50 Seats in v1; nothing in the data model caps Seats, but admin UI and
  aggregation queries are validated to 200 Seats.
- One Paddle subscription and at most one overage charge per Organisation per cycle keeps Paddle
  traffic O(organisations), not O(members) or O(completions).

### Reliability

- Seat quantity changes, cycle close, and the overage charge are idempotent (deterministic keys),
  safe under webhook re-delivery, and covered by the existing reconciliation backstop.
- Billing failures degrade to read-only, never to data loss; recovery is reactivation with no
  migration.

### Accessibility & i18n

- Workspace switcher, member management, invite flows, and the dashboard ship keyboard-operable
  with correct ARIA (menus, live regions for async results) and visible focus styles.
- Every user-facing string is translated in all six locales (en-GB, de-CH with `ss` never `ß`,
  fr, es-ES, pt-PT, it) with identical JSON key structure.
- Marketing and in-product copy follow the plain-language rules: no "end-to-end", no
  "zero-knowledge"; admin-visibility copy says "usage and costs, never conversations".

## 11. Phases

### Phase 1 — Teams v1

The scope of this spec's P0 features:

- Backend: `organisations`, `org_memberships`, `org_invites`, `org_billing` collections; ledger
  org attribution; `projects.organisation` relation; participant-must-be-member validation;
  `StateForContext` billing gate; Paddle org checkout, Seat quantity management, pooled cycle
  close, lapse read-only; rate-limited public-key endpoint; invite token endpoints.
- Frontend: Workspace switcher; org creation and checkout flow; member/Seat management and invite
  UI; admin metadata dashboard; read-only and 402 states.
- Tests: API e2e for authz (cross-org denial, 404-not-403), billing flows against the mock
  Paddle path, browser e2e for create → invite → accept → work → offboard.

### Phase 2 — Enforced policies and oversight

- **Enforced org policies**: allowed Models and a privacy-tier ceiling (org Projects cannot use
  Models above the ceiling), retention policy, and MFA-required for members.
- **Content-free audit log**: administrative events only (membership, roles, Seats, policy,
  billing) with export; never content or titles.
- **Session inventory and revocation**: Admins can list and revoke members' org sessions.

### Phase 3 — Enterprise identity (spec-level outline only)

- **Domain verification** via DNS TXT record, unlocking domain-scoped invite conveniences.
- **SSO and SCIM**: outline only in this spec; a dedicated spec must resolve how IdP-driven
  provisioning interacts with the Account Key model (likely the org-root-key v2 conversation,
  decision #9).

## 12. Success Metrics

| Metric                                                      | Target                    | How measured                                  |
| ----------------------------------------------------------- | ------------------------- | --------------------------------------------- |
| Organisations created (90 days post-launch)                 | ≥ 20                      | `organisations` with active `org_billing`     |
| Median Seats per Organisation                               | ≥ 3                       | Paddle subscription quantities                |
| Invite acceptance rate                                      | ≥ 60%                     | `org_invites` accepted / minted (non-revoked) |
| Org revenue share of MRR                                    | ≥ 25% within 2 quarters   | Ledger settlement by subject                  |
| Billing reconciliation drift                                | 0 unreconciled org cycles | Cycle summaries vs Paddle transactions        |
| Cross-org access test failures in CI                        | 0, permanently            | Filter-rule + e2e denial suites               |
| Support tickets: "admin can read chats?" answerable by docs | 100%                      | Support review against Section 9 copy         |

## 13. Timeline & Milestones

| Milestone                   | Scope                                                                               | Target      |
| --------------------------- | ----------------------------------------------------------------------------------- | ----------- |
| M0 — Spec & glossary merged | This spec, CONTEXT.md terms, business processes, web copy honesty pass              | Week 0      |
| M1 — Collections & authz    | 6.x collections, relations, filter rules, denial tests                              | Week 2      |
| M2 — Org billing            | Checkout, subject discriminator, Seat quantity, pooled cycle close, 402 gate, lapse | Week 4      |
| M3 — Membership flows       | Invite tokens, public-key endpoint, direct wrap, offboarding + rotation             | Week 6      |
| M4 — Frontend               | Workspace switcher, admin UI, dashboard, six-locale i18n                            | Week 8      |
| M5 — Teams v1 launch        | Full e2e suite green, docs and marketing copy updated                               | Week 9      |
| M6 — Phase 2 kickoff        | Policies, audit log, session inventory                                              | post-launch |

## 14. Risks & Mitigations

| Risk                                                         | Impact                       | Mitigation                                                                                                                   |
| ------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Webhook subject discriminator bug charges the wrong subject  | Wrong invoices, trust damage | Deterministic `custom_data` routing, pin tests for both subjects, cycle reconciliation alerts                                |
| Pooled overage double-charged on webhook re-delivery         | Overbilling                  | Reuse the deterministic per-cycle idempotency key and reconciliation backstop from personal PAYG                             |
| Fail-closed gate accidentally falls back to personal balance | Member pays company costs    | Explicit 402 path with a red/green test asserting personal balance is untouched                                              |
| Invite tokens leak or are brute-forced                       | Unauthorised membership      | High-entropy single-use tokens, hashed at rest, expiring, rate-limited accept endpoint                                       |
| Public-key endpoint used for account enumeration             | Privacy erosion              | Rate limiting, uniform responses, monitoring; endpoint scoped to legitimate invite/wrap flows                                |
| Offboarding rotation left incomplete (admin closes tab)      | Leaver retains future access | Rotation is a blocking admin-client step with server-side `rotation_pending` state (projects.md); e2e covers revoke → rotate |
| Admin dashboard scope creep towards content                  | Security-model breach        | Section 9 hard list; review gate: any new admin field must be provably content-free                                          |
| Read-only lapse surprises paying teams                       | Churn, support load          | Dunning banners before lapse, plain-language copy, instant restore on reactivation                                           |
| One person's Account compromise (Owner)                      | Org-wide admin abuse         | MFA available today, MFA-required policy in Phase 2; Owner actions in the Phase 2 audit log                                  |

## 15. Implementation Evidence

To be ticked with links to migrations, handlers, and tests as Phase 1 lands. All unchecked at
draft time.

- [ ] `organisations` collection + migration; API rules `nil`; schema test
- [ ] `org_memberships` collection with role enum + soft revoke; unique (organisation, user)
- [ ] `org_invites` collection with hashed token, expiry, accept/revoke lifecycle
- [ ] `org_billing` collection (payg-only, micro-rappen, Paddle ids, cycle bounds, past_due)
- [ ] `balance_transactions` org attribution field + settlement at org level
- [ ] `projects.organisation` relation + personal/org billing attribution
- [ ] Participant-must-be-member validation on org Project participant add + denial test
- [ ] Org Admins auto-Project-Admin enforced in the auth layer + test
- [ ] Paddle org checkout (quantity 1, `custom_data.org_id`) + webhook subject discriminator
- [ ] Seat add with native proration; Seat remove as next-cycle decrement (no mid-cycle refund)
- [ ] Pooled cycle close: `max(0, usage − N × 15)` one-time charge, idempotent per cycle
- [ ] `org_cycle_summaries` rows + reconciliation for org subjects
- [ ] `StateForContext` resolver; fail-closed 402 test proving no personal-balance fallback
- [ ] Lapse → read-only gate on org Projects + reactivation test
- [ ] Rate-limited client-facing public-key endpoint + enumeration-safety test
- [ ] Invite mint/deliver/accept endpoints; uniform-response (enumeration) test
- [ ] Direct-wrap flow on accept (project content key sealed to invitee's public key)
- [ ] Offboarding: membership revoke → participant revoke → forward-only rotation → seat decrement
- [ ] Organisation dissolution: Owner-only, Project-deletion confirmation, subscription cancel,
  membership soft-revoke
- [ ] Workspace switcher (no re-login/re-unlock), six locales, accessible
- [ ] Org creation + member management + invite UI in frontend
- [ ] Admin metadata dashboard (Seats, per-member cost, model mix, cycle spend) — content-free
- [ ] Cross-org denial coverage registered in `docs/api-permissions.md`
- [ ] Browser e2e: create org → invite → accept → work in org Project → offboard
- [ ] API e2e: billing flows (checkout, proration, decrement, overage, 402, lapse)
- [ ] Copy pass: "admins see usage and costs, never conversations" in all six locales
