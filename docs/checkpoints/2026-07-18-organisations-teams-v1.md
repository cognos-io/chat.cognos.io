# Checkpoint: Organisations / Teams v1 (B2B) — branch `feat/b2b-positioning`

**Date:** 2026-07-18 · **Status:** in progress · **Maintainer:** update this file at every slice
commit — it is the handoff document if another agent finishes the implementation.

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
| `37952281`  | web/: `/business` team-offer section + pricing roadmap note, six locales, honest coming-soon                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| (spec)      | `docs/specs/organisations.md` — full PRD, adversarially reviewed (2 blockers fixed: invite scope = membership only + optional day-1 project list; dissolution lifecycle §8.3)                                                                                                                                                                                                                                                                                                                                                       |
| `1d971c88`  | backend: `organisations` + `org_memberships` migrations (1760000073/74, locked rules, soft revoke, unique (org,user), dissolved_at), `projects.organisation` relation, organisations repo, 5 authed `/api/v1/orgs` routes (neutral 404), 22 tests, api-permissions.md                                                                                                                                                                                                                                                               |
| `b73025aa`  | frontend: OrganisationService (per-user persisted workspace), sidebar Workspace switcher behind `team` flag, billing-context badges (composer + project headers), workspace-scoped project lists, org API client, `workspace.*` i18n ×6, draft-preservation pin test                                                                                                                                                                                                                                                                |
| `224c8131`  | backend: org billing core — `org_billing` + `org_cycle_summaries` + ledger `organisation` migrations (1760000075/76), `billing.Subject`, `ResolveState` (conversation→project→org, resolved only after access check), `EvaluateOrgAccess` fail-closed 402 `ORG_BILLING_INACTIVE`/`ORG_BILLING_PAST_DUE` (neutral member `message` + actionable `admin_message`, organisation_id/name fields), org usage attribution (organisation + acting user, no balance mutation), pooled cycle maths + property tests, billing-access-gate doc |

## In flight (uncommitted working tree)

Org admin UI (frontend, task: replace `team` placeholder settings section) — components EXIST and
build+suite are green, but the authoring agent died at the org spend limit; remaining gaps:

1. **~117 `team.*` i18n keys missing from ALL six catalogs** (parity spec passes because they are
   missing everywhere). A kimi draft of all six locales is being produced; review against language
   rules (de-CH ss/du, fr vous, es-ES, pt-PT tu, it tu) before writing into
   `frontend/src/assets/i18n/*.json`.
2. **Component specs missing** for team-settings / org-members / org-invites / org-billing /
   offboard-member-dialog (only `org-overage.spec.ts` exists). Brief prepared at scratchpad
   `kimi-specs-brief.md` (kimi outputs spec files read-only; orchestrator applies).
3. Files: `frontend/src/app/pages/account/team/*`, `app.routes.ts` (placeholder already swapped to
   `TeamSettingsComponent`), `billing/pricing.ts`, `interfaces/organisation.ts`,
   `cognos-api.service.ts` (org billing/invite/usage methods), `utils/currency.{ts,spec.ts}`.

## To do (ordered; each = one vertical slice, one conventional commit)

### 1. Finish org admin UI (frontend)

i18n keys + component specs as above → full `CI=true pnpm --dir frontend test` + build + lint →
commit `feat(frontend): organisation admin pages`.

### 2. Paddle org subscriptions (backend) — highest risk

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
- Org checkout: `POST /api/v1/orgs/{id}/billing/checkout` (owner only) → Paddle checkout
  quantity=1, `custom_data.org_id`; env `PADDLE_PRICE_ORG_SEAT` (CHF 15/seat/month) — mirror
  `PaddleWebhookParams.PriceToPlan` wiring.
- Seat sync: `subscription.updated` items[0].quantity → `org_billing.seat_quantity`; seat ADD =
  update Paddle quantity (native proration); seat REMOVE = write `pending_seat_quantity`, applied
  at cycle rollover (never mid-cycle).
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
  `POST /orgs/{id}/invites` (owner/admin) returns the token ONCE; `GET` lists pending (no token);
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

- **Org monthly Claude spend limit is hit** — Claude subagents die mid-flight; the main loop may
  too. omp + `livemap/kimi-k2.6` is the workhorse: read-only drafting to stdout, orchestrator
  applies (the permission classifier blocks `--auto-approve` omp with write tools; don't fight it).
  The omp skill's wrapper script is broken with omp v17 — invoke `omp` directly.
- Two Playwright suites exist; only root `e2e/` is CI-gated.
- Isolated `vitest run <file>` false-fails (CdkPortal JIT) — always full `CI=true pnpm test`.
- Migration numbering: next free is `1760000077`.
- `team` feature flag stays FALSE in prod until Teams v1 passes the persona walkthroughs.
- Frontend uses Transloco; admin UI keys live under `team.*`; workspace keys under `workspace.*`.
- Roles are lowercase `owner|admin|member` in org collections (project_participants stays
  capitalised — deliberate).
- PocketBase empty dates are `''` not NULL (`removed_at = ''` is the active filter).
- Org create currently allows creation without billing; gate on org projects enforces billing —
  checkout wiring (slice 2/3) closes the loop. Dissolution flow (spec §8.3) is NOT implemented.
- The full Paddle webhook refactor plan + test tables were produced by a second model; if the
  scratchpad copy is gone, regenerate by re-running the analysis prompt in this doc's git history
  or follow §2 above — the essentials are all listed there.
