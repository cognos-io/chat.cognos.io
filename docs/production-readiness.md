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

| #   | Item                                                             | Status | Notes                                                                                 |
| --- | ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| B.1 | "Where your data goes" facts panel in model selector             | ⬜     | Data already on `Model` (provider, hosting country/region, no-retention, open-source) |
| B.2 | Persist `preferred_model_id` back to the user record             | ✅     | Persisted best-effort on explicit eligible selection                                  |
| B.3 | Privacy-tier setting (Only CH / EU / Global) gating the selector | ⬜     | `privacy_tier` is a free user data-residency preference (no plan entitlement)         |

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

| #   | Item                                                                                  | Status | Notes                                     |
| --- | ------------------------------------------------------------------------------------- | ------ | ----------------------------------------- |
| D.1 | Build images off-host; digest-pin + sign                                              | ⬜     | Prod currently builds on host via compose |
| D.2 | Pin Caddy Cloudflare DNS plugin version                                               | ⬜     |                                           |
| D.3 | Confirm/fix Caddy `trusted_proxies` / Cloudflare origin lock                          | ⬜     |                                           |
| D.4 | Compose hardening: `read_only`, `cap_drop`, `no-new-privileges`, healthchecks, limits | ⬜     |                                           |
| D.5 | Raise `minPasswordLength` to ≥12; per-account lockout                                 | ⬜     | From H-? findings                         |

## Notes for reviewers

- The model catalogue returns **all active models** annotated with `is_eligible`;
  ineligible ones render disabled in the picker (see
  `docs/business_processes/privacy-tier-gating.md`).
- Trusted-device unlock **is** implemented as a server-revocable split-key
  session (see `docs/security-model.md`); earlier "temporarily disabled" copy
  was stale and has been corrected.
