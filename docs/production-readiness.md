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
| B.2 | Persist `preferred_model_id` back to the user record             | ⬜     | Backend field exists; frontend only reads it today                                    |
| B.3 | Privacy-tier setting (Only CH / EU / Global) gating the selector | ⬜     | Backend tier-gating exists; needs a user-editable preference                          |

## Track C — Paid-GA auth blockers (design-first)

| #   | Item                                   | Status | Notes                                                              |
| --- | -------------------------------------- | ------ | ------------------------------------------------------------------ |
| C.1 | MFA (TOTP, then WebAuthn)              | ⬜ 🔎  | Protects login; separable from vault unlock                        |
| C.2 | Password-change UI                     | ⬜     | Currently no change flow; reset is disabled                        |
| C.3 | Account-key recovery ("Emergency Kit") | ⬜ 🔎  | Irreversible-by-design today; needs an ADR + sign-off on tradeoffs |

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
