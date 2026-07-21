# Go-live tech & security checkpoint — 20 July 2026

## Executive decision

**Conditional go for a deliberately small paid B2C beta (≈20–50 Account holders).
No-go for broad paid acquisition and no-go for self-serve B2B marketing until the
gates below are closed.**

**20 July remediation update:** all five application-repository P0s are closed in the working tree.
The external legal, release, restore, live-price and analytics-provisioning gates remain open and
must not be inferred from code changes.

The product has moved materially since
[2026-07-10-launch-readiness.md](./2026-07-10-launch-readiness.md). Most of that
checkpoint’s application-repo P0s are now closed in code: visible auth failures,
price consistency, trust-copy alignment, Account-deletion step-up, Organisations /
Teams v1 (flag on), and subject-aware Paddle webhooks. What remains is a mix of
**external approvals**, **conversion/ops gaps**, and explicitly accepted or scheduled P1/P2 risks.
The application money-path races and stale security document found in this review are closed below.

Infrastructure is out of scope (different repo). Legal body text in i18n may stay
English-first; non-legal i18n was checked.

### Readiness summary

| Area                                          | Assessment                                                 | Launch implication                                  |
| --------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| Encryption & data boundaries                  | Strong; honest plaintext-in-flight model                   | Ready for limited paid beta with precise claims     |
| Auth, MFA, lockout, delete step-up            | Strong; JWT still in `localStorage`                        | Conditional — acceptable for beta with CSP          |
| Authorisation / API surface                   | Excellent guardrails + collection lockdown                 | Ready                                               |
| Personal billing (PAYG / Unlimited)           | Solid webhook hygiene, fail-closed access                  | Ready once Paddle live IDs + checkout path verified |
| Org / seat billing                            | Feature-complete; concurrent/lapse Seat races fixed        | Design-partner only pending external/learning gates |
| Product UX / activation                       | First-value journey exists; search still draft             | Conditional for beta                                |
| Marketing ↔ product (Teams)                   | Product shipped; selected-design-partner GTM is explicit   | Do not sell self-serve Teams yet                    |
| Non-legal i18n                                | App catalogues at parity; marketing a11y keys English-only | Fix marketing a11y before broad EU traffic          |
| Analytics                                     | Content-free design; production emitter deliberately off   | Enable only after provisioning + live smoke         |
| Security docs hygiene                         | Current risk register supersedes the stale June audit      | Ready for diligence; keep owners/evidence current   |
| Legal / Provider / restore / release evidence | Still external checklists                                  | Hard gates — not closed in this repo                |

## Scope and method

Initial read-only review of this application repository on 20 July 2026, followed by targeted
remediation of P0.1–P0.5. Not a penetration test, legal opinion, production config audit, or
Provider-contract review.

## Application P0 remediation evidence

| P0   | Status | Resolution and executable evidence                                                                                                                                                                                                                                                                                        |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0.1 | Closed | Teams stays limited to selected design partners. `/business`, the pricing roadmap and comments say the product is shipped but personally onboarded in all six locales. `web/scripts/check-marketing-contracts.mjs` pins that posture.                                                                                     |
| P0.2 | Closed | `OrgInvitesAccept` uses a reference-counted per-Organisation lock across count → Paddle update → membership creation. `TestOrgInvitesAcceptSerialisesConcurrentSeatUpdates` proves concurrent accepts send quantities 3 then 4, not 3 twice. The lock is valid under the documented single-instance deployment invariant. |
| P0.3 | Closed | Org activation/update compares Paddle quantity with `max(active members, 3)` and immediately raises under-billing. `TestOrgPaddleWebhookReactivationReconcilesSeatsAcceptedDuringLapse` covers lapse → invite → reactivate; `TestOrgPaddleWebhookRetriesFailedSeatReconciliation` proves transient failures retry.        |
| P0.4 | Closed | Chosen fail-closed branch: production analytics is disabled and CSP remains closed to Plausible until the external dashboard checklist and live event smoke are complete. `web/scripts/check-analytics.mjs` pins both halves of that decision.                                                                            |
| P0.5 | Closed | `docs/security_findings.md` is now the current risk register with owner, status, evidence and retest trigger; it explicitly supersedes the inaccurate 6 June review retained in Git history.                                                                                                                              |

### Verification after remediation

- `go test ./... -count=1` and `go vet ./...` — pass.
- Focused billing tests under `go test -race` — pass.
- Angular unit suite — 142 files / 1,669 tests pass; frontend lint and production build pass (the
  existing component-style budget and CommonJS warnings remain warnings).
- Marketing Astro build and analytics/marketing contract checks — pass.
- `just e2e-api` — 147 Playwright API tests pass on the isolated stack.
- `rumdl check` and `git diff --check` — pass for the remediation documentation/change set.

Companion checkpoints:

- [2026-07-10-launch-readiness.md](./2026-07-10-launch-readiness.md) — prior launch
  review (many P0 remediations now landed)
- [2026-07-18-organisations-teams-v1.md](./2026-07-18-organisations-teams-v1.md) —
  Teams v1 technical/design-partner readiness
- [2026-07-18-paddle-webhook-org-plan.md](./2026-07-18-paddle-webhook-org-plan.md) —
  org webhook implementation status

## What improved since 10 July (verified)

1. **Registration / forgot-password failures are visible** — `role="alert"`, focus,
   localised error kinds (closes prior P0.1).
2. **Pricing aligned** — CHF 15 PAYG / CHF 150 Unlimited monthly / CHF 1,500 annual
   consistent across `frontend/src/app/billing/pricing.ts`, marketing, and the
   billing runbook (closes prior P0.2).
3. **Auth `next` return path** — open-redirect-safe relative redirect implemented
   (closes prior conversion leak).
4. **Account deletion step-up** — password + TOTP-when-enabled; blocked while on a
   paid plan (closes prior P0.6).
5. **Organisations / Teams v1** — production `featureFlags.team: true`; owner
   checkout, seat floor, pooled PAYG, policies, Activity log, dissolution, persona
   e2e (see 18 July checkpoint).
6. **Paddle webhook hardening** — HMAC, ±5 min timestamp window, idempotency,
   user/org subject discrimination, stale-webhook rejection.
7. **First-value onboarding** — `first-value-journey` + onboarding components exist
   (prior “guided first win” adoption item partially addressed).
8. **Frontend i18n** — exact key-set parity across `en/de/fr/es/pt/it`
   (1,542 keys each); no Swiss-`ß`, no PT-BR/`você`, no LatAm-ES leftovers found in
   product catalogues.

## Immediate launch gates

Close these before taking payment from people outside a controlled design-partner
group. Split into **must fix in this repo** vs **must prove outside this repo**.

### Must fix or decide in this repo

#### P0.1 — Resolve Teams GTM vs shipped product

**Status: Closed — selected-design-partner-only posture recorded and translated.**

Before remediation, Organisations were on in production
(`frontend/src/environments/environment.ts` `featureFlags.team: true`) while the 18 July checkpoint
called Teams v1 production-ready and marketing still sold “coming soon” with a `mailto:` lead path
(`web/src/i18n/locales/en.json` team offer + `BusinessPage.astro`).

This under-promised rather than over-promised, but it was a live contradiction: in-app Team admin
existed while `/business` said early access / email us.

**Exit criteria:** either (a) keep design-partner-only and update code comments /
checkpoint language so “not shipped” is not claimed, or (b) wire `/business` CTA
to real self-serve org checkout and stop saying “coming soon”. Do not leave both
narratives live.

#### P0.2 — Fix org seat under-billing race on concurrent invite accept

**Status: Closed — per-Organisation serialisation and concurrent API coverage added.**

Before remediation, `OrgInvitesAccept` read member count, pushed absolute seat quantity to Paddle,
then created membership (`backend/internal/handler/org_invites.go` around the `ListMembers` →
`UpdateSubscriptionQuantity` path). Concurrent accepts could both read `N` and both push `N+1`
while `N+2` members landed — revenue leakage.

**Exit criteria:** per-org serialisation or recompute-under-lock before the Paddle
update; concurrent-accept test; operator note if a temporary invite-rate limit is
used as a stopgap.

#### P0.3 — Reconcile seats when invites land during billing lapse

**Status: Closed — reactivation/update raises stale Paddle quantity; failed reconciliation
retries.**

Before remediation, Seat sync only ran when `plan_type == "payg"`. Invites accepted while
`inactive` / `past_due` skipped billing; reactivation trusted Paddle quantity and could leave extra
members unbilled.

**Exit criteria:** on reactivation / subscription update, reconcile `max(members, 3)` against Paddle
and push any upward divergence; preserve the settled next-cycle decrement policy when Paddle is
higher; test the lapse → invite → reactivate path.

#### P0.4 — Unblock analytics in the app CSP (or turn analytics off)

**Status: Closed via the fail-closed option — analytics is off until external provisioning and
smoke evidence exist.**

Before remediation, production analytics was enabled and posted to `https://plausible.io` via
`fetch` (`plausible-analytics.ts` — deliberately no vendor script). App edge headers
(`frontend/src/_headers`) `connect-src` allow only self + Cognos API/app hosts — **not**
`https://plausible.io`. Enabled events would fail closed under this CSP.

**Exit criteria:** add the Plausible Events API host to `connect-src` (and only
that), or set `analytics.enabled: false` until headers and dashboard provisioning
match. If enabling, verify with a production smoke that a content-free event arrives.

#### P0.5 — Archive or rewrite `docs/security_findings.md`

**Status: Closed — rewritten as the single current security risk register.**

The previous file was dated 2026-06-06 and claimed no MFA, 8-character passwords, no lockout, no
password-change UI, Stripe-era work. All contradicted by current code and by
`production-readiness.md` / the July checkpoints. An external reviewer opening
that version first would mistrust the whole security story.

**Exit criteria:** mark superseded, move remaining true items into a single risk
register with owner/status/evidence, or delete after merge into that register.

### Must prove outside this repo (still open)

These were already gates on 10 July and remain unchecked in-repo checklists:

| Gate                                    | Evidence location                                                                                                                  | Why it blocks charging strangers                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Legal / Provider / transfer approval    | [`docs/legal/launch-approval-checklist.md`](../legal/launch-approval-checklist.md) — all items still `[ ]`                         | Privacy product; counsel and Provider no-retention proofs are the product                   |
| Tagged green release evidence bundle    | [`docs/operations/release-evidence.md`](../operations/release-evidence.md)                                                         | Reproducible security/test/SBOM bar before money                                            |
| Restore drill + incident tabletop       | [`docs/operations/restore-drill.md`](../operations/restore-drill.md), [`incident-response.md`](../operations/incident-response.md) | Paying customers need a known RPO/RTO story                                                 |
| Live Paddle price IDs match CHF amounts | Billing runbook + deployment secrets                                                                                               | Prior P0.2 left operator verification open                                                  |
| Production `paddleClientToken`          | `environment.ts` ships `''` (hosted checkout fallback)                                                                             | Overlay optional; **hosted checkout URL path must be smoke-tested end-to-end in live mode** |
| Plausible sites/goals provisioned       | [`docs/operations/analytics-dashboard.md`](../operations/analytics-dashboard.md)                                                   | Cannot learn from a paid beta without the funnel                                            |

## P1 — fix in the first paid-beta sprint

1. **Personal device / session revoke UI** — Security page covers Emergency Kit,
   password, MFA only. Org admins can revoke member sessions; individuals cannot
   list/revoke their own sessions. Combined with auth token in `localStorage`, a
   compromise has no self-serve kill switch. Highest trust/support risk once money
   is involved.
2. **Rate-limit Account registration** — PocketBase rate rules cover password
   auth, verification, reset, email change — not `users` record create
   (`backend/internal/hooks/rate_limits.go`). App-layer identity limiter does not
   wrap native signup. Trial-seed / verification-email abuse is unbounded at the
   application layer.
3. **Vault unlock / password-change errors lack `role="alert"`** — Registration
   got the accessible error pattern; `vault-password-dialog` unlock failures and
   account-security password errors still render red text only. Wrong Account Key
   is the highest-stakes failure in the product.
4. **Marketing i18n a11y keys English-only** — Every non-`en` marketing catalogue
   is missing `a11y.skipToContent` and `nav.toggle` (plus legal keys, excluded per
   scope). Runtime falls back to English silently; no web parity test exists
   (unlike `frontend` `translation-parity.spec.ts`).
5. **Org dissolution non-atomic with Paddle** — Cancel-in-Paddle then local
   transaction; inverse failure needs operator runbook (documented). Acceptable
   for design partners; harden or automate reconciliation before broad B2B.
6. **Hero Redaction copy still absolute** — Deeper marketing pages qualify
   “best-effort”; hero / how-it-works still reads as guaranteed detection. Align
   one sentence.
7. **Closed alongside P0.1 — stale comment** — `environment.development.ts` now says Teams is
   shipped in-app and limited to selected design partners.
8. **Marketing site has no security headers file in this repo** — App has a tight
   `_headers` CSP; `web/` has none. Confirm ownership in the deployment repo or
   add an equivalent artefact here.
9. **PAYG has no hard spend circuit breaker** — Fair-use alerts only; postpaid by
   design. Needs explicit business sign-off for the beta cohort size.

## P2 — track, do not block beta

- Auth JWT remains in PocketBase default `localStorage` store (XSS = session
  theft; CSP/Trusted Types mitigate, do not eliminate).
- Passkeys / WebAuthn still spec-only; do not market them.
- MFA TOTP encryption-key rotation strands seeds (no keyring).
- Self-serve refund endpoint is log-only / operator follow-up — UI must not imply
  instant refund.
- Conversation full-text search still **Draft** (`docs/specs/conversation-search.md`);
  title search only — ChatGPT-switcher expectation gap.
- Dedicated `/account/usage` nav still behind `featureFlags.usage: false` (usage
  does appear on Plan & billing — confirm that is enough for PAYG transparency).
- CSP has no `report-to` / `report-uri`.
- Enabling Paddle.js overlay later needs CSP `script-src` / `connect-src` /
  `frame-src` updates; today’s empty token + hosted redirect avoids that until
  deliberately enabled.
- Hardcoded `aria-label="Paddle"` on the logo component (brand name; low risk).
- Refund-request free-text reason logged at Info (PII-ish; not chat content).
- Independent protocol pentest still outstanding before strong enterprise claims.

## What is already strong (keep this)

- Security model correctly separates encrypted-at-rest history from live
  plaintext Completion processing.
- MFA quality: encrypted seeds, replay protection, hashed recovery codes,
  trusted-device tokens, correct PocketBase auth interception.
- API auth-surface test auto-enumerates routes; chat collections stay rule-null
  with Go handlers + cross-Account denial tests.
- Paddle personal billing: signature, idempotency, past_due, refunds,
  server-chosen price IDs (client cannot pick raw price), invoice PDF
  cross-tenant denial.
- Org completion fail-closed: never falls back to a member’s personal balance.
- Content-free analytics contract and prop guard.
- Emergency Kit ceremony gates progression on copy/download acknowledgement.
- Six-language app UI with parity tests and European regional variants.

## Go / no-go by motion

| Motion                                    | Verdict            | Condition                                                                                                                |
| ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Founder-supported paid B2C beta (20–50)   | **Conditional go** | Smoke live checkout; legal counsel sign-off for the markets you actually sell into; restore drill dated                  |
| Broad B2C paid ads / open signup          | **No-go**          | Plus registration throttle, session revoke, analytics funnel live, release evidence green                                |
| Self-serve B2B / Teams GA                 | **No-go**          | External launch gates, self-serve marketing/checkout decision and design-partner learnings first                         |
| Design-partner B2B (manual, limited orgs) | **Conditional go** | Operator runbook for dissolution + seat reconciliation; do not promise SSO/SCIM                                          |

## Suggested beta success criteria (unchanged hypotheses)

Reuse the 10 July bar unless interviews say otherwise:

- ≥60% verified registrations → first successful Completion
- ≥40% activated return within 7 days
- ≥20% who exhaust trial start a paid Plan
- &lt;5% need human help with Account Key onboarding
- Zero confirmed plaintext-at-rest, cross-Account access, or checkout/price mismatch incidents

## Launch exit checklist (this review)

### Application repo

- [x] Teams GTM decision recorded and marketing/product aligned (P0.1)
- [x] Concurrent invite seat race fixed + tested (P0.2)
- [x] Lapse → invite → reactivate seat reconcile fixed + tested (P0.3)
- [x] App CSP allows Plausible Events API **or** analytics disabled until then (P0.4)
- [x] `security_findings.md` archived / superseded (P0.5)
- [ ] Registration rate limit in place
- [ ] Personal session list + revoke
- [ ] Vault unlock errors use `role="alert"` + focus
- [ ] Marketing `a11y.*` / `nav.toggle` in all six locales + web parity test
- [ ] Live-mode checkout smoke (hosted or overlay) with production price IDs

### External / ops (not this repo)

- [ ] Counsel-signed legal launch checklist
- [ ] Provider no-retention + DPA evidence retained
- [ ] Tagged CI release evidence archived
- [ ] Restore drill + incident tabletop signed
- [ ] Plausible production goals/funnels verified content-free

## Final assessment

Cognos is **much closer to a defensible paid beta** than on 10 July: the trust
surface (encryption story, MFA, auth failures, pricing honesty, deletion step-up)
and the money surface (Paddle webhooks, personal billing lifecycle) are real.
Teams v1 arriving before marketing was ready is the inverse of the usual startup
problem — good engineering, unfinished GTM.

The remaining blockers for charging strangers are external proof and operations: legal / Provider
approval, tagged release evidence, restore and incident exercises, live checkout/price verification,
and—before analytics is enabled—Plausible provisioning plus a content-free live smoke. Treat Teams
as design-partner-only until those gates and real-money learnings support a separate GA decision.

---

_Checkpoint updated with application P0 remediation evidence on 20 July 2026._
