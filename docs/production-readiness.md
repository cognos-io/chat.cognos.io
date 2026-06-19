# Production readiness checklist

Tracking the external due-diligence review against the work to reach **paid GA**
for ~200–500 privacy-conscious users. Status legend: ✅ done · 🚧 in progress ·
⬜ not started · 🔎 needs decision.

## Track A — Green CI + trust fixes

| #   | Item                                      | Status | Notes                                                                      |
| --- | ----------------------------------------- | ------ | -------------------------------------------------------------------------- |
| A.1 | Failing `chat.component.spec.ts` (NG0201) | ✅     | Stubbed `PublicShareService`; 250/250 unit tests green                     |
| A.2 | Overclaiming UI/marketing copy            | ✅     | Composer + 2 bento cards reworded to match `security-model.md`             |
| A.3 | Stale security docs                       | ✅     | READMEs, H-8 finding, privacy-tier-gating doc corrected                    |
| A.4 | Provider error-message logging leak       | ✅     | `safeErrorSummary` drops free-text; tests assert no leak                   |
| A.5 | `security.txt`                            | ✅     | `security@cognos.io`, expiry → 2027-06-18, served at `/.well-known/`       |
| A.6 | e2e suite in CI                           | ✅     | New `e2e` job; suite validated 87/92 locally (5 needed mock-wired backend) |

## Track B — Privacy control surface

| #   | Item                                                           | Status | Notes                                                                               |
| --- | -------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| B.1 | "Where your data goes" facts list (Account → Models available) | ✅     | Per-model residency badge, hosting, context, locked states; matches design mock     |
| B.2 | Default model + persona in one preferences object              | ✅     | Both in encrypted `user_preferences`; model selection derives reactively            |
| B.3 | Data-processing residency selector (Switzerland / EU / Global) | ✅     | Patches `privacy_tier`, re-gates the catalogue; tier cards + zero-retention callout |

Also done: settings page now scrolls (shell overflow fix); stale login reset
copy removed; a "set as default" control on the personas page; and a browser
e2e proving the default model round-trips through preferences across a reload.

## Track C — Paid-GA auth blockers

Model decided: **Account Key = sole data/recovery key; password = auth-only and
resettable** (see `security-model.md` §5/§9). This shrinks the work — no third
recovery secret, and password-change is a pure auth op.

| #   | Item                                                      | Status | Notes                                                             |
| --- | --------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| C.1 | Wrap secret key under `Argon2id(Account Key)` (`v2`)      | ✅     | v2-only (greenfield, no migration); helpers unit-tested           |
| C.2 | Unlock UX: decrypt step asks for Account Key only         | ✅     | No password field at all; always asks for the Account Key         |
| C.3 | Re-enable password reset                                  | ✅     | Hook removed; tests assert request 204 + confirm changes password |
| C.4 | Password-change UI                                        | ✅     | Account "Password" card; re-auths after change; unit + e2e tested |
| C.5 | MFA                                                       | 🔎     | Needs a decision — see below                                      |
| C.6 | Emergency Kit onboarding (download/print the Account Key) | ✅     | Downloadable plain-text kit on the new-account dialog             |

Also done: single-password signup (confirm field removed — a typo is now
recoverable via reset).

No v1→v2 migration: launch is greenfield, so the legacy password+Account-Key
scheme was removed outright rather than carried for backward compatibility.

**C.5 MFA — decision needed.** PocketBase's built-in MFA combines password /
OAuth2 / **OTP (email one-time code)** — there is **no native TOTP
(authenticator app) or passkeys/WebAuthn**. So the options are:

- **Email-OTP MFA (native, ~modest):** enable MFA + OTP on the users collection;
  login becomes password → emailed code. Built-in, low risk. Weaker factor
  (email-account compromise defeats it).
- **Authenticator-app TOTP (custom, large):** store a per-user TOTP secret, QR
  enrolment, verify, recovery codes, wire into login. The factor the persona
  expects, but a net-new subsystem PocketBase doesn't provide.
- **Passkeys/WebAuthn (custom, large):** strongest UX, also not native.

**Recommendation:** ship GA with **optional native email-OTP MFA + clear
disclosure of its limit**, and put **passkeys/WebAuthn** on the near-term
roadmap (skip standalone TOTP). Rationale: the **Account Key already protects the
actual sensitive data** — it never reaches the server, so even a full
password+email compromise cannot decrypt chat history. MFA here protects
_account access_ (sending new messages, billing, metadata), not the encrypted
corpus, so the gap is narrower than for a typical app. Email-OTP is a low-risk
native win for that access layer; passkeys are the better long-term second
factor **and** double as the quick-unlock factor that would let us reintroduce a
short idle-lock (see §10 / the removed idle auto-logout). Owner: deferred to a
separate MFA branch.

## Track D — Production hardening (infra)

| #   | Item                                                                                  | Status | Notes                                                                          |
| --- | ------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| D.1 | Build images off-host; digest-pin + sign                                              | ⬜     | Needs your prod/deploy context                                                 |
| D.2 | Pin Caddy Cloudflare DNS plugin version                                               | ⬜     | Needs your prod/deploy context                                                 |
| D.3 | Confirm/fix Caddy `trusted_proxies` / Cloudflare origin lock                          | ⬜     | Needs your prod Caddy config                                                   |
| D.4 | Compose hardening: `read_only`, `cap_drop`, `no-new-privileges`, healthchecks, limits | 🚧     | Prepared in `docker-compose.yaml`; **staging smoke-test before prod deploy**   |
| D.5 | Raise `minPasswordLength` to ≥12; sign-in rate limit                                  | ✅     | Min=12 + authWithPassword 100→10/5min; **per-account lockout now implemented** |

Fixed (Account Key re-entry): the cause was the **30-minute inactivity
auto-logout** (`app.component.ts`), which fully logged out and wiped the
split-key vault session — not the auth-token TTL. Removed it (the 30-day-token
attempt was reverted): the session now stays unlocked until explicit lock/logout
(or the 5-day token lapsing after disuse). A short idle-lock can return once a
quick-unlock factor (passkey/PIN) exists, since the Account Key is the only
unlock factor today.

## Post-review hardening (2026-06-19)

- **Email change re-enabled** — verified request → confirm flow (email is not a
  key input under v2); account page has an Email card + a confirm page; only
  unverified direct PATCHes stay blocked. Backend + browser e2e cover it.
- **Password-reset UI rebuilt** — `forgot-password`/`reset-password` were stale
  "unavailable" placeholders despite reset being enabled server-side (C.3); now
  functional request + confirm pages.
- **Per-account login lockout** — 5 consecutive failures lock an account for
  15 min, defeating IP-rotating credential guessing the per-IP limit can't.
- **Idle-TTL on vault wrap keys** — `last_used_at` touched on use + a 30-day
  idle sweep, bounding abandoned-but-open devices now that idle auto-logout is
  gone (TTL > token TTL, so returning users don't re-enter the Account Key).
- **Browser e2e coverage** — added gated root-suite specs for the email-change,
  password-reset, and confirm-email-change surfaces. Made the `frontend/e2e`
  suite (35 app-level specs) **self-contained** so it can run standalone/CI.
  Both suites now run fully green on a fresh stack and gate in CI:
    - Root `e2e/` (**101/101**): fixed the stale `user-key-pair` fixture
    (v1 → `account_key_v2`), the mock AI base URL (bifrost double-`/v1`), and —
    the real blocker — **taught `cmd/mock-ai-provider` to stream SSE** (bifrost
    routes completions as a stream; the mock only returned plain JSON). Updated
    the completion specs to parse the backend's own SSE response and refreshed
    the lock/unlock journey for v2.
    - `frontend/e2e/` (**67/67**): rewrote the drifted specs — v2 vault helpers
    (no `#confirmPassword` / `#account-password`), profile → `/account`,
    always-on nav links, real Account page; de-flaked the export test. **Now
    gated** via a `frontend-e2e` CI job.

## Second review round (2026-06-19) — trust copy + docs

- **Storage-claim overclaim fixed** — `DataProcessingComponent` no longer says
  "we keep nothing" / "never stores your prompts or responses anywhere". New
  wording: no-retention providers + Cognos never stores **plaintext** prompts or
  responses; chat history is saved **encrypted**.
- **Docs aligned to `account_key_v2`** — removed disabled-password-reset and
  "password + Account Key" unlock wording and the `password_account_key_v1`
  reference from README, backend/README, the model-selector spec/checklist, and
  `security_findings` (N-4 marked fixed). Obsolete `*-blocked` process docs
  replaced with `password-reset` / `email-change` (both enabled). Canonical line:
  *password authenticates; the Account Key unlocks encrypted data; losing the
  Account Key means encrypted data is unrecoverable.*
- **Deletion/retention copy** — the Delete account card now states that records
  required for billing, tax, fraud prevention, or legal compliance may be
  retained while account + encrypted chat data are deleted.
- **MFA** — recommendation recorded under C.5 (ship optional email-OTP + disclose;
  passkeys near-term). Deferred to a separate branch.
- **Deploy hardening (Track D.1–D.4)** — still open; needs your prod/deploy
  context (off-host builds, digest-pin/sign, Caddy plugin pin, Cloudflare origin
  lock, staging smoke-test). Owner: you, separately.

## Notes for reviewers

- The model catalogue returns **all active models** annotated with `is_eligible`;
  ineligible ones render disabled in the picker (see
  `docs/business_processes/privacy-tier-gating.md`).
- Trusted-device unlock **is** implemented as a server-revocable split-key
  session (see `docs/security-model.md`); earlier "temporarily disabled" copy
  was stale and has been corrected.
