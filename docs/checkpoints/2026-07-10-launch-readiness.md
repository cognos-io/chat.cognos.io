# Launch readiness checkpoint — 10 July 2026

## Executive decision

**Recommendation: go with conditions for a deliberately small paid B2C beta; no-go for broad B2C
paid acquisition or a general B2B/team launch.**

The product is not starting from a fragile place. Its core security model, authorisation guardrails,
client-side key handling, MFA implementation, billing recovery states, six-language support and
privacy explanations are unusually mature for this stage. The main launch risk is inconsistency at
the boundary between product, marketing, legal and operations. For a privacy product, a wrong price,
an overstated promise or an unreproducible security configuration damages the very trust Cognos is
selling.

Before taking payment from strangers, clear the launch gates in
[Immediate launch gates](#immediate-launch-gates). After that, invite **20–50 B2C Account holders**
into a founder-supported paid beta, measure the activation funnel and interview them weekly. Treat
current B2B demand as paid design-partner work for individual professional Accounts. Do not yet sell
team administration, central policy or enterprise readiness.

### Readiness summary

| Area                             | Current assessment                                                                  | Launch implication                                  |
| -------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| Encryption and data boundaries   | Strong baseline; custom protocol still needs independent review                     | Suitable for a limited beta with precise claims     |
| Authentication and authorisation | Strong tests and MFA; destructive deletion lacks step-up auth                       | Fix deletion before paid launch                     |
| Product UX and accessibility     | Strong foundations; conversion-critical auth failures can be silent                 | Fix signup/recovery feedback first                  |
| B2C value proposition            | Clear and differentiated                                                            | Validate with a small paid cohort after trust gates |
| B2B/team readiness               | Professional single-seat wedge only                                                 | No-go for a general team offer                      |
| Billing and pricing              | Good in-app lifecycle; contradictory prices/copy                                    | Reconcile before accepting payment                  |
| Legal and trust material         | Candid foundation but visibly unfinished                                            | Legal completion is a launch gate                   |
| Deployment/config interface      | Current checked-in instructions are stale/broken                                    | Publish one authoritative interface before launch   |
| Analytics and learning loop      | Good privacy-preserving implementation; dashboard setup outstanding                 | Configure before sending traffic                    |
| Verification                     | Frontend/marketing build and lint pass; full security scan not reproducible locally | Require a retained green pinned CI run              |

## Scope and method

This checkpoint is a read-only review of the application repository. Deployment implementation is
out of scope, but the contract between this repository and the deployment repository—images,
configuration, secrets, health checks, headers, backup/restore and rollback—is in scope.

The review covered:

- backend security, cryptographic boundaries, logging, authentication, authorisation, billing,
  dependency scanning and backup expectations;
- the Angular application and Astro marketing site, including registration, Account Key ceremony,
  chat, billing, localisation, accessibility, trust copy and B2B conversion;
- specs, business-process documentation, legal documents, production-readiness notes, CI,
  container/config examples and analytics;
- launch sequencing through a startup engineering and adoption lens.

Three parallel reviews were synthesised: security/privacy, UX/accessibility, and
product/market/docs. Findings are based on repository evidence, not a penetration test, legal
opinion, production configuration review or external model-provider contract review.

## What is already strong

### Security and privacy foundation

- The security model correctly distinguishes encrypted storage from live processing: Cognos and the
  selected Provider can see plaintext during a Completion, while stored Message content is
  ciphertext. This is the right foundation for honest positioning
  ([security model](../security-model.md)).
- Server crypto uses standard CSPRNG and NaCl box/secretbox primitives rather than custom ciphers
  (`backend/internal/crypto/encrypt.go:11`).
- Provider error logging is deliberately content-free, production gateway log levels are clamped,
  and citation logging records counts rather than text
  (`backend/internal/gateway/bifrost_client.go:46`,
  `backend/internal/gateway/bifrost_client.go:715`, `backend/cmd/api/main.go:201`).
- The auth-surface guardrail enumerates the API and forces public routes to be explicit; raw
  PocketBase Conversation data is locked down and cross-Account access is tested
  (`backend/cmd/api/api_auth_surface_test.go:27`,
  `backend/cmd/api/collection_rules_participants_test.go:111`).
- AI spend is gated on verified email, passwords have a 12-character minimum, and both per-IP
  throttling and per-Account lockout exist (`backend/cmd/api/routes.go:799`,
  `backend/db/migrations/1760000036_users_min_password_length.go:10`,
  `backend/internal/hooks/login_lockout.go:23`).
- Authenticator-app MFA is substantive: seeds are encrypted without a plaintext fallback,
  enrolment rechecks the Account password, disabling requires password plus TOTP, and recovery codes
  are high-entropy, one-time and stored only as hashes (`backend/internal/mfa/seed.go:24`,
  `backend/internal/handler/mfa_manage.go:57`, `backend/internal/mfa/codes.go:11`).
- The Account Key onboarding ceremony requires the Account holder to copy/download the Emergency Kit
  before continuing, is translated, and has strong browser E2E coverage
  (`frontend/src/app/components/vault-password-dialog/vault-password-dialog.component.ts:139`,
  `e2e/tests/auth.spec.ts:24`).

### User experience and commercial foundation

- Six European locales are real product infrastructure, with catalogue parity checks, localised
  marketing routes, `hreflang`, translated accessible labels and region-appropriate language
  (`frontend/src/app/i18n/languages.ts`,
  `frontend/src/app/i18n/translation-parity.spec.ts`,
  `web/src/layouts/BaseLayout.astro:19`).
- Accessibility foundations include skip links, semantic landmarks, reduced-motion support,
  reusable dialog/loading primitives, and localised accessible names
  (`frontend/src/app/app.component.html:1`, `web/src/layouts/BaseLayout.astro:94`).
- Chat failures retain the attempted Message and expose an alert with retry; billing covers dunning,
  invoices, refunds, usage visibility and a slow-activation state rather than assuming perfect
  webhook timing.
- The product has meaningful privacy differentiation beyond encrypted history: browser Redaction,
  privacy-tier selection, temporary Conversations, disappearing Messages, encrypted custom Personas
  and reusable encrypted Attachments.
- Product analytics has a careful content-free event contract and a swappable adapter. The design is
  aligned with the product promise even though the production dashboard setup remains incomplete
  ([product analytics spec](../specs/product-analytics.md)).
- Marketing already provides a plausible professional wedge in law, fiduciary, healthcare and
  agency work, and the app has a mature self-serve billing base on which to test willingness to pay.

## Immediate launch gates

All of these should be closed before accepting payment from people outside a controlled design
partner group.

### P0.1 — Make registration and recovery failures visible

`RegisterComponent` catches registration errors and only clears its loading state; no localised
error, toast or retry guidance is rendered
(`frontend/src/app/pages/auth/register/register.component.ts:223`). Forgot-password has the same
silent-failure pattern
(`frontend/src/app/pages/auth/forgot-password/forgot-password.component.ts:109`). Duplicate email,
validation and network errors can therefore look like a dead button at the highest-friction point in
the funnel.

**Exit criteria:** localised actionable messages for expected validation, duplicate, rate-limit,
network and server cases; focus/live-region behaviour; rainy-path unit tests; browser coverage for
failure, retry and success.

### P0.2 — Establish one price and one honest billing explanation

The app and marketing advertise Unlimited at CHF 150/month and CHF 1,500/year
(`frontend/src/app/billing/pricing.ts:1`, `web/src/i18n/locales/en.json:235`), while the Paddle
operations runbook instructs CHF 100/month and CHF 1,000/year
([billing runbook](../billing-ops-runbook.md)). PAYG also says both “CHF 15/month minimum” and
“Spend nothing in months you don't use it” (`web/src/i18n/locales/en.json:222`).

**Exit criteria:** one canonical pricing source reflected in Paddle IDs, frontend config, marketing,
all six locales and the operator checklist; a plain example invoice; explicit minimum charge,
overage, tax/VAT, renewal, cancellation and guarantee wording; a checkout E2E that asserts displayed
and returned product/price identity.

### P0.3 — Align every privacy claim to the implemented trust boundary

The strongest marketing lines generalise that every other AI trains on input, that a Provider
“keeps nothing”, and that there is “nothing to leak, sell, or hand over”
(`web/src/i18n/locales/en.json:17`, `web/src/i18n/locales/en.json:73`,
`web/src/i18n/locales/en.json:183`). The security model and privacy material are more accurate:
plaintext is processed live and exact Provider handling depends on the approved Provider,
configuration and contract (`docs/security-model.md:66`, `docs/legal/privacy.md:184`).

**Exit criteria:** claims describe Cognos specifically, distinguish encrypted-at-rest history from
live processing, name no-retention processing only where contractually confirmed, and avoid
universal competitor claims. Redaction copy must say it reduces exposure and is best-effort, not
imply every sensitive value is detected. Review all six locales together.

### P0.4 — Complete legal and subprocessor material

The checked-in privacy material still contains unresolved EU/UK representative language, Providers
“to be confirmed”, unfinished incident/access-control statements, an insertion placeholder for a
vendor-safeguards table, and incomplete retention periods (`docs/legal/privacy.md:42`,
`docs/legal/privacy.md:197`, `docs/legal/privacy.md:268`, `docs/legal/privacy.md:292`,
`docs/legal/privacy.md:354`). Auth pages also link to a combined
`/privacy-policy-and-terms/` route which this site does not expose, and login says “By signing up…”
(`frontend/src/app/pages/auth/register/register.component.ts:139`,
`frontend/src/assets/i18n/en.json:217`).

**Exit criteria:** counsel-approved terms/privacy/subprocessor and retention text; firm EU/UK scope;
working, separate localised Terms and Privacy links at registration and login; DPA/security-contact
path for professional buyers. This checkpoint is not legal advice.

### P0.5 — Publish and test one deployment/configuration interface

The current repository cannot reproduce its documented deployment path:

- `docker-compose.yaml` builds `./web` and mounts `web/Caddyfile`, but neither `web/Dockerfile` nor
  `web/Caddyfile` exists;
- CI also builds the missing `web` and `backend` Dockerfiles
  (`.github/workflows/ci.yml:189`);
- the current backend image lives at `container/backend/Containerfile`, while README instructions
  still use on-host `docker compose --build` and old paths (`README.md:55`);
- repository guidance says Podman, while deployment docs say Docker;
- production readiness refers to Cloudflare, README refers to Bunny, and no authoritative boundary
  explains which repo owns TLS, proxy trust, headers and image promotion.

Secret wiring is also incomplete. The loader supports Requesty, Paddle API/webhook and MFA secret
files (`backend/internal/config/api.go:187`), but Compose mounts only Infomaniak and backup secrets.
The `.env.template` supplies a Requesty secret-file path which will fail startup when that file is
absent, while Paddle/MFA cannot be mounted through the documented Compose file.

**Exit criteria:** create one deployment-interface document, linked prominently from README, that
names the external deployment repo as authoritative and specifies:

- supported topology and ownership of DNS/CDN/proxy/TLS;
- canonical, off-host image builds, immutable digest promotion and rollback;
- required versus optional runtime variables, build-time frontend values and every secret-file
  mount, without secret values;
- environment-specific Provider allowlists, privacy-tier/residency constraints and no-retention
  checks;
- CSP/Trusted Types/HSTS and other edge headers, including how `frontend/src/_headers` is consumed
  and verified;
- trusted-proxy/real-IP handling, origin lock and the single-instance limitation of in-memory rate
  limiting;
- health/readiness checks, database/data-volume ownership, migrations, backup schedule, restore,
  smoke tests and rollback;
- a config validation/dry-run command that fails production startup when billing, MFA, Provider,
  mail/public URL or pricing configuration required by enabled features is absent.

Update or remove the stale Compose/CI paths so this repo does not present a second, broken source of
truth.

### P0.6 — Require step-up authentication for Account deletion

The deletion route only requires a bearer token and then irreversibly deletes Account-owned data
and the Account (`backend/cmd/api/routes.go:351`, `backend/internal/handler/account.go:27`). Because
the auth token is stored browser-side, session theft can become irreversible destruction.

**Exit criteria:** require recent password verification and TOTP when enabled, use a short-lived
step-up grant, confirm the destructive scope in translated UI, and test wrong password,
missing/wrong TOTP, replay/expiry, cross-Account denial and successful deletion.

### P0.7 — Prove restore and incident readiness

Borgmatic has sensible backup/check/retention configuration, but README documents only backup
creation, not restoration; the existing findings say restore verification was not checked
(`backup/borgmatic.d/cognos.yaml:18`, `README.md:69`, `docs/security_findings.md:305`). Privacy text
also says incident response is still being finalised.

**Exit criteria:** perform and date a clean restore drill; record RPO/RTO; document backup failure,
Provider outage, account/billing incident and personal-data-breach paths; specify severity,
notification, owner/on-call, customer/status communication and support escalation. Either staff the
one-business-day support/continuous-monitoring promise or soften it.

### P0.8 — Retain a green, pinned release evidence bundle

During this review, frontend lint, frontend production build and marketing build passed. The
frontend build warned that `message-form` CSS exceeds its 10 kB warning budget (12.12 kB) and
reported several CommonJS optimisation bailouts. A normal local `go test ./...` attempt failed
before tests because cached Go 1.26.4 objects did not match the installed 1.26.5 tool. A separate
explicitly pinned audit run passed Go tests and `go vet`; `gosec` surfaced two triageable findings
(environment- controlled file path and deliberately ignored analytics flush error). `govulncheck`
and `staticcheck` did not produce trustworthy local results because of the toolchain/cache mismatch.

**Exit criteria:** one retained release-candidate CI run using the declared toolchain with Go tests,
vet, govulncheck, staticcheck/gosec, frontend and shared-library unit tests, builds, both Playwright
suites, marketing accessibility tests, dependency audit, container scan and SBOM. Pin scanner/tool
versions and image bases/digests so the result is reproducible.

### P0.9 — Turn on the measurement loop before traffic

The analytics implementation and event discipline are good, but Plausible production sites, goals
and funnels remain unchecked (`docs/specs/product-analytics.md:450`). The event definition for
`vault_unlock_prompted` also still includes an `idle_logout` reason even though idle logout was
removed.

**Exit criteria:** provision both sites, configure documented goals/funnels, validate events in
production without content/identifiers, remove stale semantics, and record baseline conversion for
the first 2–4 weeks.

## Highest-leverage adoption work

### 1. Build one guided “safe first win”

The Account Key ceremony is thorough, but after registration the Account holder lands directly in
chat (`frontend/src/app/app.routes.ts:6`). There is no guided path that demonstrates the reason to
switch from ChatGPT.

Create a short, dismissible first-run journey:

1. Save the Emergency Kit, with password-manager/print guidance.
2. Explain in one sentence that a live request is readable while it is answered, but saved history
   is encrypted.
3. Choose Switzerland/EU/global processing based on the Account holder's needs.
4. Paste a realistic professional example or use a role-specific starter.
5. See and confirm a Redaction preview.
6. Send, receive a useful answer, and learn where encrypted history can be found.

Track start, each meaningful step, first successful Completion, first return and payment without
capturing content. The activation goal should be **first useful privacy-safe answer**, not account
creation.

### 2. Reduce Account Key loss before it happens

Unrecoverable encryption is coherent, but key loss will otherwise become involuntary churn. Add a
later “verify your Emergency Kit” reminder, optional second-device enrolment, a device/session list
with revoke, and clear pre-payment disclosure. Passkey quick unlock is a strong follow-up; it can
support a future short idle Lock without making Account holders repeatedly type the Account Key.

### 3. Make finding past work table stakes

Paying ChatGPT switchers expect to retrieve old work. Current search primarily covers decrypted
titles while full Message search remains a draft
([conversation search spec](../specs/conversation-search.md)). Prioritise client-side
full-Conversation search and reconcile the draft status of long-Conversation compaction with the
implementation before adding more novelty features.

### 4. Convert trust into evidence

Create a compact trust centre containing the current architecture/threat model, plaintext-in-flight
boundary, Provider/subprocessor list, retention/deletion/backup schedule, vulnerability disclosure,
audit status, uptime/status, DPA route and direct source/protocol links. Honesty is already a
product strength; evidence should be just as easy to find.

### 5. Close conversion leaks

- Preserve a validated relative return path after login; the auth guard currently has a `next` TODO
  (`frontend/src/app/guards/auth.guard.ts:17`).
- Replace the B2B `mailto:` form with a privacy-minimal durable submission or scheduling path with
  confirmation, spam controls, retention/consent copy and analytics
  (`web/src/components/BusinessPage.astro:147`).
- Add a tasteful localised “Create your private Conversation” CTA to Public shares and measure it.
- Add a browser E2E spanning marketing CTA → registration error/success → Emergency Kit → first
  Completion → trial/billing boundary → checkout return/activation. Add axe sweeps for auth, Account
  Key dialogs, chat, pricing, settings and Public shares.

## B2C launch shape

After the P0 gates, Cognos is suitable for a **20–50 person paid beta** aimed at privacy-conscious
professionals already paying for AI. Keep it founder-supported and narrow:

- recruit around two or three concrete jobs, such as reviewing confidential correspondence,
  preparing client-safe drafts and reasoning over sensitive documents;
- state the live-processing and Redaction limitations before first use;
- interview active, inactive and cancelling Account holders weekly;
- review activation, first-week return, first payment, support requests, Account Key readiness and
  cancellation reasons;
- avoid regulated-production assurances until legal, Provider and independent review evidence is
  complete.

Suggested beta success criteria to set before recruitment:

- at least 60% of verified registrations reach a first successful Completion;
- at least 40% of activated Account holders return within seven days;
- at least 20% of Account holders who exhaust the trial start a paid Plan;
- fewer than 5% of activated Account holders require human help with Account Key
  recovery/onboarding;
- zero confirmed plaintext-at-rest, cross-Account access or price/checkout mismatch incidents;
- at least 10 interviews show repeated use of the same two or three privacy-sensitive jobs.

These are starting hypotheses, not forecasts. Revisit them after the first cohort rather than
optimising feature count.

## B2B launch shape

The current B2B product is best described as **Cognos for individual professionals**, not Cognos for
teams. Marketing says SSO/admin controls are coming; production flags disable team features;
Projects/sharing and collaboration pricing remain unresolved
(`frontend/src/environments/environment.ts:24`, `docs/specs/projects.md:1`, `todos.md:10`).

Run up to three paid design-partner pilots with explicit limitations and individual Accounts. Learn
which controls buyers actually require before committing to SSO/SCIM. Likely order:

1. Organisation ownership, seats, invitations and offboarding.
2. Admin role and enforced privacy tier, retention and MFA policy.
3. Content-free security activity/audit export and device/session revocation.
4. Consolidated invoicing, DPA/subprocessor/security questionnaire pack.
5. Domain verification, then SSO/SCIM when validated by real deals.

Conversation/Project key rotation on offboarding and auditable administration matter before SSO.
Until those exist, do not promise central control or safe team offboarding.

## Important post-beta hardening

- Commission an independent application pentest and focused review of the custom browser key,
  split-key session and Conversation rotation protocol before strong enterprise claims.
- Move the PocketBase auth token away from `localStorage` when practical; until then, verify
  deployed CSP/Trusted Types and maintain XSS regression coverage.
- Introduce a content-free security activity log for auth changes, MFA, Public shares, key rotation,
  device revocation and deletion.
- Design an MFA encryption-key keyring/dual-decrypt migration. Current rotation strands enrolled
  seeds and requires re-enrolment.
- Replace or document the in-memory rate limiter before multi-instance deployment; bound identifier
  cardinality and verify real client IP at the edge.
- Clean up stale security authorities. `docs/security_findings.md` still claims no MFA, an
  8-character minimum and Stripe-era work despite the shipped TOTP/Paddle/lockout baseline. Archive
  it or mark it superseded by a single risk register with owner, status, evidence and retest date.
- Address the frontend style-budget warning and review large optional document/OCR dependencies for
  lazy-loading, performance and supply-chain exposure.

## Launch exit checklist

- [ ] Registration and password-recovery failures are visible, translated, accessible and tested.
- [ ] One price source drives all six locales, app UI, Paddle configuration and runbooks.
- [ ] Marketing/privacy/Redaction claims match the implemented and contracted boundary.
- [ ] Legal, subprocessor, retention and DPA material has no placeholders or unresolved claims.
- [ ] Auth pages link to working, localised Terms and Privacy pages.
- [ ] The deployment repo/interface, canonical images and all config/secret inputs are documented.
- [ ] Production config validation fails closed for every enabled paid/security feature.
- [ ] Account deletion requires password and MFA step-up and has rainy-path tests.
- [ ] A restore drill is completed and incident/rollback/support paths are documented.
- [ ] Pinned CI produces a fully green, retained security/test/build/SBOM evidence bundle.
- [ ] Plausible sites, goals and funnels are live and verified without content collection.
- [ ] A guided first-value journey and Account Key loss-prevention follow-up are in place.
- [ ] The B2B page accurately sells individual professional use or design partnerships only.
- [ ] A reliable B2B lead path replaces the `mailto:`-only form.
- [ ] A current risk register supersedes stale security findings.

## Final assessment

Cognos has earned the right to be excited: the hard-to-fake parts—security boundaries,
authorisation discipline, Account Key ceremony, MFA, billing lifecycle, localisation and transparent
limitations—are substantially present. It is not yet ready to be marketed broadly as a finished
privacy product because several visible promises and operational contracts disagree with the code
and with each other.

Clear the P0 trust gates, then launch narrowly and learn. The best chance of adoption is not another
large feature. It is a reliable signup, one demonstrably useful privacy-safe workflow, pricing that
never surprises, and evidence that makes a nervous non-technical professional comfortable enough to
pay.
