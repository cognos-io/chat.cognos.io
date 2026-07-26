---
description: Single review queue for unresolved Cognos product, security and operational work
last_reviewed: 2026-07-22
name: open-points
---

# Open Points

This is the only product and engineering review queue. Add an item here instead of leaving TODOs in
business processes, specs, checkpoints or READMEs. Runbooks may keep execution checklists, but the
decision, priority and owner belong here.

## Review first

| ID     | Priority    | Open point                                                                       | Recommendation                                                                                                                      |
| ------ | ----------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| OP-002 | P0 external | Counsel, Provider retention and data-transfer approval remain unproven.          | Keep charging limited to controlled design partners until the [approval checklist](./legal/launch-approval-checklist.md) is signed. |
| OP-003 | P0 external | No retained tagged release bundle proves tests, scans, SBOM and deployed digest. | Complete the [release evidence](./operations/release-evidence.md) for every paid release.                                           |
| OP-004 | P0 external | Restore and incident response are documented but not evidenced as rehearsed.     | Run and date the [restore drill](./operations/restore-drill.md) and [incident tabletop](./operations/incident-response.md).         |
| OP-005 | P0 external | Live Paddle prices, checkout, webhook and refund behaviour need production proof.| Complete the [billing runbook](./billing-ops-runbook.md) with synthetic Accounts before charging outside design partners.           |

## Security and accessibility

The accepted PocketBase JWT-in-`localStorage` risk remains in
[`security_findings.md`](./security_findings.md); revisit it before enterprise claims or after an
XSS report.

Closed in this engineering pass (removed from the queue): OP-006 registration rate limit, OP-007
sign out other devices, OP-008 TOTP seed encryption keyring, OP-010 auth error focus + marketing
catalogue-key parity, OP-014 PAYG one-per-cycle soft alert (hard breaker + founder max beta
exposure deferred pending real spend data), OP-034 ChatGPT/Claude import fixtures, OP-036
property-test coverage refresh.

## Operations and billing

| ID     | Priority    | Open point                                                                       | Recommendation                                                                                                                                                                                 |
| ------ | ----------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OP-011 | P0 external | Plausible sites, goals, funnels and a content-free live smoke are not evidenced. | Keep analytics and its CSP allowance off until the [dashboard checklist](./operations/analytics-dashboard.md) passes.                                                                          |
| OP-013 | P1          | Organisation dissolution can succeed in Paddle and then fail locally.            | Before self-serve Teams, replace the synchronous flow with the persisted retryable state machine in the [billing runbook](./billing-ops-runbook.md#6-organisation-dissolution-reconciliation). |
| OP-037 | P2          | PAYG has no hard circuit breaker or founder-approved maximum beta exposure.      | Decide thresholds only from real spend and support data after the soft alert (closed OP-014) has run in beta.                                                                                  |

Operational execution steps remain in their runbooks; do not duplicate every checkbox here.

## Conversations and retrieval

| ID     | Priority | Open point                                                                                                                              | Recommendation                                                                                                                                                           |
| ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OP-016 | P2       | Duplicate chat rejects Project Conversations, Attachments and copies above 500 Messages; public-key signatures are not server-verified. | Keep fail-closed limits until demand exists; treat signature verification as cross-cutting key hardening, then design Project/Attachment copying with re-wrapping tests. |
| OP-017 | P2       | Search lacks snippets, older-page hydration, content-language detection and a persistent encrypted index.                               | Treat these as one Search V2 research bundle; prioritise only from observed search failures.                                                                             |
| OP-018 | P2       | Browser ETag/304 caching and authenticated CDN caching are unimplemented.                                                               | Build browser validators first. Keep authenticated CDN caching off until principal scoping, purge and key-rotation/delete failure semantics are proven.                  |
| OP-019 | P2       | Compaction has no per-Conversation disable, model or cadence controls.                                                                  | Measure summary drift and complaints before adding controls; keep WebGPU summarisation as research.                                                                      |
| OP-020 | P2       | Power-user context, token, compaction and reasoning diagnostics are incomplete; exports omit Reasoning.                                 | Design one opt-in diagnostics surface and make export behaviour an explicit product choice.                                                                              |

Bookmark note editing and a compressed/paginated minimap are minor enhancements. Re-open them as
separate items only when demand justifies displacing the work above.

## Data, documents and sharing

| ID     | Priority   | Open point                                                                                                                           | Recommendation                                                                                                                   |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| OP-022 | P2         | The browser document tool loop and later sandboxed code/PPTX/Typst ideas are unbuilt.                                                | Prove live Requesty tool-call transport first. Keep sandboxed code and extra formats as separate, optional decisions.            |
| OP-023 | P2         | Attachments are Account-owned; there is no shared Project file library.                                                              | Write a fresh scoped-file security proposal before building shared files; do not reuse the personal Library model implicitly.    |
| OP-024 | P2         | Redaction still needs a first-run explainer, broader multilingual corpus, chunked large-input detection and optional local counters. | Ship the explainer and corpus quality first; add chunking before raising Attachment limits; keep counters local and counts-only. |
| OP-025 | P1         | Participant Redaction-key wrapping, Temporary Conversation hydration and mapping-write failure handling remain incomplete.           | Add wrapping to participant flows; persist mappings before durable Messages when possible; test every viewer and failure path.   |

The Comprehensive server-assisted Redaction mode stays disabled. It requires a separate privacy
design before implementation.

## Models and Providers

| ID     | Priority | Open point                                                                         | Recommendation                                                                                                                                 |
| ------ | -------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| OP-026 | P2       | Passkeys are not implemented, and their first-factor versus MFA role is undecided. | Decide role, relying-party/origin policy and recovery first. Passkeys must never replace the Account Key.                                      |
| OP-027 | P2       | Model-picker Auto mode is unbuilt.                                                 | Defer until evidence shows Account holders cannot choose; any rules should be local, deterministic and explainable.                            |
| OP-028 | P2       | Custom or self-hosted Model endpoints are unbuilt.                                 | Run discovery before design because this changes plaintext routing, trust, billing, network access and support boundaries.                     |
| OP-039 | P2       | Cognos MFA is not challenged on Google OAuth sign-in (password AuthMethod only).   | When demand or risk warrants it, challenge OAuth like password; keep Account Key separate. See [mfa-login](./business_processes/mfa-login.md). |
| OP-040 | P2       | Sign in with Apple is not offered.                                                 | Needs paid Apple Developer Program + Services ID; ship after Google is proven. Passkeys remain a separate decision (OP-026).                   |

Infomaniak search, rich source previews, audio transcription and Project Personas are not approved
roadmap items. Drop them unless customer evidence brings them back.

## Product and infrastructure review

| ID     | Priority          | Open point                                                                                          | Recommendation                                                                                                        |
| ------ | ----------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| OP-031 | P2                | Domain verification, SSO and SCIM are unbuilt.                                                      | Treat them as one Enterprise identity programme; require an Account-Key compatibility design before SSO/SCIM.         |
| OP-032 | P2                | Analytics opt-out UI, self-hosting, proxying and revenue properties are optional enhancements.      | Keep the current privacy-preserving interface; revisit only after the production measurement loop works.              |
| OP-033 | P2                | Standalone authenticated Conversation-sharing UI is absent although backend Participant APIs exist. | Build only if product research prefers it alongside Public shares and Team Projects.                                  |
| OP-035 | P2 infrastructure | Same-origin app/API serving and edge HTTP/2/3 behaviour are not verified.                           | Evaluate same-origin first because it removes connection overhead; treat protocol verification as secondary evidence. |

Refund fulfilment remains operator-driven for beta. Keep the UI explicit that it submits a request;
automate only when volume makes the operational path unreliable.

## Testing debt

| ID     | Priority | Open point                                                                                  | Recommendation                                                                                                                 |
| ------ | -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| OP-038 | P2       | Web-search system-message and conditional Vertex Claude paths are not fully live-validated. | Test only families enabled in the catalogue; fail closed for unknown offset/stream shapes.                                     |

## Blocked external / manual

These stay open until evidence outside this repository lands. Do not close them with code-only
scaffolding.

| ID     | Priority    | Open point                                                                                                                                | Blocker                                                                                                                                                        |
| ------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OP-009 | P1 external | The encryption protocol has no independent penetration test or cryptographic review.                                                      | Commission a review; track findings in the [risk register](./security_findings.md) (SR-010).                                                                   |
| OP-012 | P1 external | Exact PAYG overage transaction timing is unknown until a live cycle completes.                                                            | Complete the [first real overage-cycle gate](./billing-ops-runbook.md#11-first-real-payg-overage-cycle-gate); then tighten `reconciled` and add a drift alert. |
| OP-015 | P1 external | Non-English product catalogues have not had native-speaker review; privacy/terms legal bodies still fall back to English.                 | Review de-CH, fr-CH, es-ES, pt-PT and it-CH (including legal page bodies); record sign-off in the [i18n guide](./i18n.md).                                     |
| OP-021 | P1 quality  | Generated DOCX, PDF and XLSX output needs a current Word, LibreOffice, Pages and Google Docs compatibility pass.                          | Run a synthetic manual matrix and retain dated results before calling exports polished.                                                                        |
| OP-029 | P1 external | Requesty has not confirmed whether Vertex grounding fees are billed, and some Provider-family web-search behaviour lacks live validation. | Written fee confirmation from Requesty; live spikes only for Provider families actually routed.                                                                |
| OP-030 | P1 external | Gemini image transport/cost needs a gated live test; size, aspect and quality controls are absent.                                        | Validate transport and operator pricing before enabling the Model. Defer controls until demand is clear.                                                       |

## ADR candidates

The following repository decisions have useful evidence, but accepted ADRs still need the original
decision-makers and dates confirmed:

| Candidate                                                          | Evidence                                                                          | Missing confirmation                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------- |
| Separate authentication from decryption with the Account Key       | [`security-model.md`](./security-model.md) and risk SR-005                        | Date and decision-makers                    |
| Use server-revocable split-key persistent unlock                   | [`security-model.md`](./security-model.md)                                        | Date and decision-makers                    |
| Run PocketBase as a single-writer, single-instance service         | [`deployment-interface.md`](./deployment-interface.md)                            | Date and decision-makers                    |
| Accept PocketBase JWT storage in `localStorage` for this phase     | Risk SR-003 in [`security_findings.md`](./security_findings.md)                   | Date and decision-makers                    |
| Replace Ory with PocketBase authentication                         | Git history                                                                       | Revisit condition, date and decision-makers |
| Use a private deployment repository and immutable digest promotion | [`deployment-interface.md`](./deployment-interface.md)                            | Revisit condition, date and decision-makers |
| Keep document rendering behind a browser worker/facade             | [`frontend/src/app/documents/README.md`](../frontend/src/app/documents/README.md) | Revisit condition, date and decision-makers |

Use the [ADR template](./adr/0000-template.md) only after those facts are confirmed.
