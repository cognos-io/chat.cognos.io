# Security risk register

Updated 20 July 2026. Owner: Cognos engineering unless a row says otherwise.

This register supersedes the 6 June 2026 security findings that previously lived at this path. That
review described retired deployment files and pre-MFA application behaviour; Git history preserves
it for audit purposes. Current controls and launch evidence live in:

- [`security-model.md`](./security-model.md) — authoritative trust boundaries and cryptographic
  model
- [`production-readiness.md`](./production-readiness.md) — current application posture
- [`checkpoints/2026-07-20-go-live-tech-security.md`](./checkpoints/2026-07-20-go-live-tech-security.md)
  — go-live decision and remediation evidence
- [`deployment-interface.md`](./deployment-interface.md) — application/deployment ownership boundary

Statuses: **Open** needs engineering or operational work; **Accepted** is consciously tolerated for
the stated launch motion; **External gate** needs evidence from an operator, Provider, counsel or
independent reviewer outside this repository. Accepted risks must be revisited before the trigger in
the final column.

| ID     | Priority | Risk / impact                                                                                        | Owner                    | Status        | Evidence / mitigation                                                                                                                                           | Retest trigger                                  |
| ------ | -------- | ---------------------------------------------------------------------------------------------------- | ------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| SR-001 | P1       | An Account cannot list and revoke its own sessions after token theft.                                | Application              | Open          | Org-admin revocation exists; personal session inventory does not. App CSP and token rotation on logout reduce, but do not remove, the risk.                     | Before broad paid signup                        |
| SR-002 | P1       | Native Account registration lacks an application-layer identity throttle.                            | Application              | Open          | Password auth/reset routes are rate-limited; the `users` record-create route is not.                                                                            | Before broad paid signup                        |
| SR-003 | P2       | PocketBase keeps the auth JWT in `localStorage`; successful XSS could steal a session.               | Application / security   | Accepted      | Tight CSP, Trusted Types and sanitisation lower XSS likelihood; logout rotates the token key.                                                                   | Before enterprise claims or after an XSS report |
| SR-004 | P2       | Rotating the MFA encryption key without a keyring would strand existing TOTP seeds.                  | Application / ops        | Open          | Encrypted seeds, replay prevention and hashed recovery codes are live; the deployment key must remain stable until rotation support exists.                     | Before rotating the production MFA key          |
| SR-005 | P2       | Loss of the Account Key makes encrypted history unrecoverable.                                       | Product / security       | Accepted      | This is explicit in onboarding, the Emergency Kit ceremony and `security-model.md`; no recoverable copy is retained by Cognos.                                  | Before adding managed recovery                  |
| SR-006 | P1       | Marketing-site security headers are not evidenced in this application repository.                    | Deployment operations    | External gate | The app header contract is `frontend/src/_headers`; deployment ownership is documented in `deployment-interface.md`.                                            | Before broad public acquisition                 |
| SR-007 | P0       | A release without a tagged green evidence bundle cannot prove tests, scans, SBOM or deployed digest. | Release owner            | External gate | [`operations/release-evidence.md`](./operations/release-evidence.md) defines the required bundle.                                                               | Before charging outside design partners         |
| SR-008 | P0       | Restore and incident response remain assumptions until rehearsed.                                    | Operations               | External gate | [`operations/restore-drill.md`](./operations/restore-drill.md) and [`operations/incident-response.md`](./operations/incident-response.md) define the exercises. | Before charging outside design partners         |
| SR-009 | P0       | Provider retention/transfer terms and market-specific legal text require external approval.          | Counsel / Provider owner | External gate | [`legal/launch-approval-checklist.md`](./legal/launch-approval-checklist.md) is the evidence checklist; application claims stay aligned to `security-model.md`. | Before charging in each market                  |
| SR-010 | P2       | The encryption protocol has not had an independent penetration test or cryptographic review.         | Founder / security       | Open          | Internal threat modelling, cross-Account denial tests and the public security model are present; no external-audit claim is made.                               | Before strong enterprise security claims        |

## Closed in the 20 July remediation

- Organisation Seat additions are serialised per Organisation. This relies on the documented
  single-writer, single-instance PocketBase deployment invariant.
- Reactivation and subscription updates raise an under-billed Paddle Seat quantity to
  `max(active members, 3)`; transient reconciliation failures are retryable.
- Product and marketing now consistently describe Teams as available only to selected design
  partners, not as either unshipped or self-serve GA.
- App analytics is disabled until Plausible provisioning and a live content-free event smoke are
  evidenced; the CSP therefore remains closed to the vendor host.

## Review discipline

1. Update a row when its control, owner or evidence changes.
2. Add the dated test, runbook or external evidence location; never write “fixed” without it.
3. Move resolved rows to the checkpoint that closed them instead of keeping stale claims open here.
4. Review P0/P1 rows before every paid release and all rows at least monthly.
