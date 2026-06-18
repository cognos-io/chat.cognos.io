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

| #   | Item                                                       | Status | Notes                                                            |
| --- | ---------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| C.1 | Wrap secret key under `Argon2id(Account Key)` (`v2`)       | ⬜     | Drop password from KDF; unlock reads `unlock_scheme` per record  |
| C.2 | Unlock UX: decrypt step asks for Account Key only          | ⬜     | Login already authenticates; no password at the decrypt step     |
| C.3 | Re-enable password reset                                   | ⬜     | Remove `ForbidPasswordReset` hook; data now survives a reset     |
| C.4 | Password-change UI                                         | ⬜     | Pure auth op (PocketBase); no key re-wrap                        |
| C.5 | MFA (TOTP, then WebAuthn)                                  | ⬜     | Login protection                                                 |
| C.6 | Emergency Kit onboarding (download/print the Account Key)  | ⬜     | Make safeguarding the Account Key unmistakable                   |

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
