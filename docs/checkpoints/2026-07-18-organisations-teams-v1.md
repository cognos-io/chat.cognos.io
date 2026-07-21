# Checkpoint: Organisations / Teams v1 (B2B) — branch `feat/b2b-positioning`

**Date:** 2026-07-18 · **Status:** technically ready for selected design partners; not self-serve
GA · **Maintainer:** update this file
at every slice commit — it is the handoff document if another agent finishes the implementation.

The single source of truth for the design is
[`docs/specs/organisations.md`](../specs/organisations.md) (§4 Decisions are founder-settled — do
not re-litigate). Domain terms: `CONTEXT.md` (Organisation, Org membership, Org role, Seat,
org-owned Project, Workspace). Personas [`PER-005`](../personas/05-team-lead-org-owner.md) /
[`PER-006`](../personas/06-org-member-professional.md) are UX acceptance criteria, not colour.

## Done (committed, in order)

| Commit      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0a6677bc`  | CONTEXT.md glossary: Organisation terms, refreshed Project entry, ambiguity table                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| (personas)  | `docs/personas/05-team-lead-org-owner.md` + `06-org-member-professional.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| (processes) | `docs/business_processes/org-{billing,seat-management,project-access}.md` + README index + project-management guardrail                                                                                                                                                                                                                                                                                                                                                                                                             |
| `37952281`  | web/: `/business` team-offer section + pricing roadmap note, six locales; copy superseded on 20 July to describe the shipped, selected-design-partner offer                                                                                                                                                                                                                                                                                                                                                                         |
| (spec)      | `docs/specs/organisations.md` — full PRD, adversarially reviewed (2 blockers fixed: invite scope = membership only + optional day-1 project list; dissolution lifecycle §8.3)                                                                                                                                                                                                                                                                                                                                                       |
| `1d971c88`  | backend: `organisations` + `org_memberships` migrations (1760000073/74, locked rules, soft revoke, unique (org,user), dissolved_at), `projects.organisation` relation, organisations repo, 5 authed `/api/v1/orgs` routes (neutral 404), 22 tests, api-permissions.md                                                                                                                                                                                                                                                               |
| `b73025aa`  | frontend: OrganisationService (per-user persisted workspace), sidebar Workspace switcher behind `team` flag, billing-context badges (composer + project headers), workspace-scoped project lists, org API client, `workspace.*` i18n ×6, draft-preservation pin test                                                                                                                                                                                                                                                                |
| `224c8131`  | backend: org billing core — `org_billing` + `org_cycle_summaries` + ledger `organisation` migrations (1760000075/76), `billing.Subject`, `ResolveState` (conversation→project→org, resolved only after access check), `EvaluateOrgAccess` fail-closed 402 `ORG_BILLING_INACTIVE`/`ORG_BILLING_PAST_DUE` (neutral member `message` + actionable `admin_message`, organisation_id/name fields), org usage attribution (organisation + acting user, no balance mutation), pooled cycle maths + property tests, billing-access-gate doc |

Later commits (same order of work):

- `a148091e` backend: subject-dispatched Paddle webhooks (user vs org via custom_data /
  subscription-id / customer-id fallbacks), org activation → org_billing with seats, seat sync,
  pooled cycle close with old-quantity floor + pending decrement applied after, overage one-time
  charge, lapse on past_due/cancel/chargeback, refunds.organisation + organisations
  .paddle_customer_id (migration 1760000077), 13 org webhook tests + 3 per-user fallback pins.
- `ab7a7aaf` backend: org billing endpoints per contract — owner-only checkout
  (`custom_data.org_id`, billed Seat quantity `max(members, 3)`, config `paddle.price_org_seat` /
  `COGNOS_PADDLE_PRICE_ORG_SEAT`) and
  portal; owner/admin billing state (floor/pooled/projected overage) and per-member usage metadata;
  CheckoutRequest gains OrgID/Quantity; role-gate + aggregation tests; api-permissions rows.
- (frontend admin pages committed earlier as `feat(frontend): organisation admin pages`.)

## Release-candidate state

**Teams v1 is feature-complete in the application and limited to selected design partners. It is
not self-serve GA.** The persona-driven red/green loop now covers Sophie (Owner) and
Nils (Member) in the browser, plus organisation lifecycle, authorization, lapse, dissolution, and
compaction accounting through Playwright API tests. Screenshots were captured and reviewed at each
critical state: create/checkout, billing, invite, members, offboarding, Workspace context, lapse,
Activity log, destructive dissolution, and the resulting Personal Workspace.

The review found and fixed: clipboard failure handling; member identity/context ambiguity; Seat
addition sync; draft loss on 402; incomplete key rotation; unrecoverable last-Admin offboarding;
missing Activity log and dissolution UI; direct-write lapse bypasses; and provider-backed
compaction incorrectly charging the acting member instead of the Organisation. The implementation
evidence checklist in `docs/specs/organisations.md` is current.

P2 is COMPLETE: enforced org policies (privacy-tier ceiling `ORG_PRIVACY_TIER`, retention default
with shorter-wins, `ORG_MFA_REQUIRED` gates), six-locale policies UI, content-free Activity log +
CSV export, and admin session revocation. P3 remains spec-only by founder decision (spec §11 Phase
3); DNS-TXT, SSO and SCIM are not Phase 1 launch dependencies.

The signed-out invite `?token=` deep link is fixed (`3873e470`). Organisation dissolution is
implemented across API and frontend (`e480548f`, `5695fd7d`). The final broad suites passed and the
`team` flag is ON in production, development, and e2e.

Final validation evidence: backend `go test ./...`; frontend lint and 139 files / 1,630 tests;
production Angular build; 49-page Astro build; Playwright organisation API 4/4; compaction API 8/8;
and the final Sophie + Nils browser pass 2/2. The regenerated lapse, Activity log, dissolution, and
Personal-safety screenshots were visually reviewed with no open launch-blocking UX TODOs.

Known v1 operational constraint: Paddle cancellation and the local PocketBase dissolution
transaction cannot be atomic. Cancellation runs first, and any Paddle failure leaves local state
unchanged and retryable. A persisted reconciliation saga is a future hardening option if operations
show the narrow inverse failure window (Paddle accepted cancellation, local transaction failed). The
state machine and interim operator procedure are specified in
[`docs/billing-ops-runbook.md` §6](../billing-ops-runbook.md#6-organisation-dissolution-reconciliation).

## To do (ordered; each = one vertical slice, one conventional commit)

### 1. Finish org admin UI (frontend) — DONE (committed)

### 2. Paddle org subscriptions (backend) — DONE (commits a148091e + ab7a7aaf)

Follow the saved plan (kimi analysis) — saved at
[2026-07-18-paddle-webhook-org-plan.md](./2026-07-18-paddle-webhook-org-plan.md):
subject-discriminated webhook. Key points:

- PIN FIRST: per-user webhook behaviour is already well covered by existing tests in
  `backend/cmd/api/paddle_webhook_test.go`; add the three missing fallback pins
  (customer-id fallback on activate, subscription-id fallback on update, adjustment customer-id
  fallback) BEFORE refactoring.
- Introduce `Subject{Kind: user|org}` dispatch in `paddle_webhook.go` (`resolveWebhookSubject`:
  custom_data.org_id → org, custom_data.user_id → user, then paddle_subscription_id lookup in
  org_billing/user_billing, then paddle_customer_id) — `billing.Subject` already exists from
  commit `224c8131`.
- Org checkout: `POST /api/v1/orgs/{id}/billing/checkout` (owner only) → Paddle checkout at
  **quantity 3 minimum** (`max(active members, 3)`) and `custom_data.org_id`; env
  `COGNOS_PADDLE_PRICE_ORG_SEAT` (CHF 15/Seat/month) — mirror `PaddleWebhookParams.PriceToPlan`
  wiring.
- Seat sync: `subscription.updated` items[0].quantity → `org_billing.seat_quantity`; seat ADD =
  update Paddle quantity to `max(members, 3)` (native proration); seat REMOVE = write
  `pending_seat_quantity = max(remaining members, 3)`, applied at cycle rollover (never mid-cycle,
  never below three Seats).
- Pooled cycle close on rollover: sum ledger rows `organisation = org` in cycle window →
  `ComputeOrgCycleSummary` (already implemented in billing/payg.go) → one one-time charge via the
  existing CHF 0.01-unit quantity mechanism → `org_cycle_summaries` row (idempotent by
  deterministic summary id, same pattern as user cycles).
- Org past_due/cancel/chargeback → org_billing past_due/inactive (the completion gate then 402s;
  lapse = read-only, already enforced by `EvaluateOrgAccess`).
- Org-specific test list: see appendix table in the saved plan (13 cases,
  `TestOrgPaddleWebhook*`).

### 3. Org routes: invites, offboarding, project participants (backend)

Build EXACTLY against the fixed API contract (also mirrored in frontend
`cognos-api.service.ts` org methods):

- `POST /orgs/{id}/billing/checkout` → `{checkout_url}`; `GET /orgs/{id}/billing` (owner/admin) →
  plan/seats/cycle/floor/pooled usage/projected overage; `GET /orgs/{id}/billing/portal` (owner);
  `GET /orgs/{id}/usage` (owner/admin, metadata only: per-member cost/completions/top models).
- `org_invites` migration: hashed single-use token, role, optional invited_email
  (≤1 pending per (org,email) — reissue replaces), optional project_ids, expiry.
  `POST /orgs/{id}/invites` (owner/admin) returns the raw token ONCE in the POST body (UI builds
  `{origin}/invite?token=…` and shows that full link once); `GET` lists pending (no token);
  `DELETE /orgs/{id}/invites/{inviteId}` revokes. `POST /api/v1/org-invites/accept {token}` (any
  authed account) → active membership + seat (bump Paddle quantity → proration).
- Offboard `DELETE /orgs/{id}/members/{userId}` (owner/admin; owner cannot offboard self):
  soft-revoke membership → revoke project participation on org projects + forward-only project key
  rotation (project rotation routes may need adding — `projectparticipants.Repo` methods exist,
  unrouted) → set `pending_seat_quantity`.
- Public-key endpooint for the wrap step: rate-limited, authenticated, only resolvable in a live
  invite/membership relationship (spec §8.1/§9). `UserPublicKey(userID)` primitive exists at
  `backend/internal/auth/repo.go:76`.
- Enforce participant-must-be-active-org-member on org-project participant add; org Admins have
  implicit Project-Admin (auth layer, not rows).
- **Projects API responses must expose the plaintext `organisation` field** — the shipped frontend
  workspace scoping expects it (`ProjectRecord.organisation`).
- Every new route: register in the auth-surface guardrail, add cross-user denial tests
  (`filter_rules_test.go` style), api-permissions.md rows.

### 4. e2e (root `e2e/`, `just e2e-api` isolated stack)

Org lifecycle, invite→accept, org-project billing gate 402 fail-closed (member healthy personal
balance + lapsed org → 402 AND personal balance untouched), cross-user denial, browser: switcher +
admin pages.

### 5. Phase 2 — policies, audit, sessions

Org policy (allowed Models/privacy-tier ceiling, retention, MFA-required) enforced at completion
time + admin UI; content-free `org_audit_events` + CSV export; device/session inventory +
revocation. Spec §11 Phase 2.

### 6. Phase 3 — domain verification (DNS TXT); SSO/SCIM stays spec-only

### 7. Final gates

- Persona walkthroughs with Playwright (Sophie: create→checkout→invite→dashboard→offboard→lapse;
  Nils: accept→switch→work→billing cues→offboarded safety), functionality AND design polish;
  collect issue list → fix → REPEAT until clean (founder instruction).
- Full builds/tests/lint (backend `go test ./...`, frontend `CI=true pnpm test`, web build,
  `just e2e-api`), i18n parity ×6, rumdl, docs sweep (api-permissions, checklist ticks in spec §
  Implementation Evidence), memory update.

## Gotchas for whoever continues

- `omp` + `livemap/kimi-k2.6` was used as an independent adversarial reviewer. Its findings must be
  verified against executable paths: the useful finding in this pass was org compaction billing
  attribution; alleged import and Project-cascade blockers were disproved by the request contract
  and existing cascade tests.
- Two Playwright suites exist; only root `e2e/` is CI-gated.
- Isolated `vitest run <file>` false-fails (CdkPortal JIT) — always full `CI=true pnpm test`.
- Migration numbering: next free is `1760000082`.
- `team` feature flag is ON in production after the final browser/API and broad-suite gates passed.
- Frontend uses Transloco; admin UI keys live under `team.*`; workspace keys under `workspace.*`.
- Roles are lowercase `owner|admin|member` in org collections (project_participants stays
  capitalised — deliberate).
- PocketBase empty dates are `''` not NULL (`removed_at = ''` is the active filter).
- Org creation intentionally precedes checkout. Missing/inactive billing fails closed across all
  org Project content writes; admin, read, delete, and key-rotation recovery paths remain usable.
- The full Paddle webhook refactor plan + test tables were produced by a second model; if the
  scratchpad copy is gone, regenerate by re-running the analysis prompt in this doc's git history
  or follow §2 above — the essentials are all listed there.
