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

## Track D — Production hardening (infra)

| #   | Item                                                                                  | Status | Notes                                                                        |
| --- | ------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| D.1 | Build images off-host; digest-pin + sign                                              | ⬜     | Needs your prod/deploy context                                               |
| D.2 | Pin Caddy Cloudflare DNS plugin version                                               | ⬜     | Needs your prod/deploy context                                               |
| D.3 | Confirm/fix Caddy `trusted_proxies` / Cloudflare origin lock                          | ⬜     | Needs your prod Caddy config                                                 |
| D.4 | Compose hardening: `read_only`, `cap_drop`, `no-new-privileges`, healthchecks, limits | 🚧     | Prepared in `docker-compose.yaml`; **staging smoke-test before prod deploy** |
| D.5 | Raise `minPasswordLength` to ≥12; sign-in rate limit                                  | ✅     | Min=12 + authWithPassword 100→10/5min; per-account lockout is a follow-up    |

Open (Account Key re-entry): the real cause of frequent re-entry is the
**30-minute inactivity auto-logout** (`app.component.ts`), which fully logs out
and wipes the split-key vault session — not the auth-token TTL (a 5-day token
auto-refreshes every 5 min while open). Decision needed on the idle/auto-lock
behaviour; the high-entropy Account Key being the only re-unlock factor is what
makes any aggressive lock painful.

## Notes for reviewers

- The model catalogue returns **all active models** annotated with `is_eligible`;
  ineligible ones render disabled in the picker (see
  `docs/business_processes/privacy-tier-gating.md`).
- Trusted-device unlock **is** implemented as a server-revocable split-key
  session (see `docs/security-model.md`); earlier "temporarily disabled" copy
  was stale and has been corrected.
