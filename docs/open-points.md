---
description: Single review queue for unresolved Cognos product, security and operational work
last_reviewed: 2026-07-21
name: open-points
---

# Open Points

This is the only product and engineering review queue. Add an item here instead of leaving TODOs in
business processes, specs, checkpoints or READMEs. Runbooks may keep execution checklists, but the
decision, priority and owner belong here.

## Review first

| ID     | Priority    | Open point                                                                                             | Recommendation                                                                                                                      |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| OP-001 | P0          | [Account deletion can delete shared Organisation data](#op-001-account-deletion-and-organisation-data) | Block unsafe deletion before broad Teams use; add the four denial/survival tests below.                                             |
| OP-002 | P0 external | Counsel, Provider retention and data-transfer approval remain unproven.                                | Keep charging limited to controlled design partners until the [approval checklist](./legal/launch-approval-checklist.md) is signed. |
| OP-003 | P0 external | No retained tagged release bundle proves tests, scans, SBOM and deployed digest.                       | Complete the [release evidence](./operations/release-evidence.md) for every paid release.                                           |
| OP-004 | P0 external | Restore and incident response are documented but not evidenced as rehearsed.                           | Run and date the [restore drill](./operations/restore-drill.md) and [incident tabletop](./operations/incident-response.md).         |
| OP-005 | P0 external | Live Paddle prices, checkout, webhook and refund behaviour need production proof.                      | Complete the [billing runbook](./billing-ops-runbook.md) with synthetic Accounts before charging outside design partners.           |

### OP-001: Account deletion and Organisation data

`backend/internal/handler/account.go` checks only personal billing, then deletes every Project whose
`creator` is the caller. Organisation Projects also store the creating member in `creator`, so a
non-owner member can currently delete a shared Organisation Project and its cascading data by
deleting their Account. An Organisation Owner instead receives a generic failure because the owner
relation prevents deletion.

Target behaviour:

1. Account deletion never deletes Organisation content merely because the Account holder created
   it.
2. An Organisation Owner receives `409` until ownership is transferred or the Organisation is
   dissolved.
3. Deleting an ordinary member offboards them, revokes Project access and completes required key
   rotation before deleting the Account.
4. Personal data still deletes and retained financial records remain detached.

Add API tests for all four cases before changing the
[Account deletion process](./business_processes/account-delete.md).

## Security and accessibility

| ID     | Priority | Open point                                                                                                                 | Recommendation                                                                                                          |
| ------ | -------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| OP-006 | P1       | Registration has no dedicated application-layer limiter.                                                                   | Add a tested IP and abuse throttle before open acquisition; keep neutral responses to avoid Account enumeration.        |
| OP-007 | P1       | Individuals cannot list or revoke their own sessions.                                                                      | Add “sign out other devices” using auth token-key rotation; preserve the current Organisation-admin control separately. |
| OP-008 | P1       | The TOTP seed encryption key has no versioned keyring.                                                                     | Add key versions and staged re-encryption before rotating the production key.                                           |
| OP-009 | P1       | The encryption protocol has no independent penetration test or cryptographic review.                                       | Commission one before strong enterprise security claims; track findings in the [risk register](./security_findings.md). |
| OP-010 | P1       | Some security errors lack alert/focus treatment, and marketing accessibility keys are not proven equal across six locales. | Add live-region/focus tests and a marketing catalogue-parity test in one accessibility hardening slice.                 |

The accepted PocketBase JWT-in-`localStorage` risk remains in
[`security_findings.md`](./security_findings.md); revisit it before enterprise claims or after an
XSS report.

## Operations and billing

| ID     | Priority    | Open point                                                                       | Recommendation                                                                                                                                                                                 |
| ------ | ----------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OP-011 | P0 external | Plausible sites, goals, funnels and a content-free live smoke are not evidenced. | Keep analytics and its CSP allowance off until the [dashboard checklist](./operations/analytics-dashboard.md) passes.                                                                          |
| OP-012 | P1          | Exact PAYG overage transaction timing is unknown until a live cycle completes.   | Keep the conservative `billed >= expected` check; after the first overage cycle, tighten reconciliation and alert on drift.                                                                    |
| OP-013 | P1          | Organisation dissolution can succeed in Paddle and then fail locally.            | Before self-serve Teams, replace the synchronous flow with the persisted retryable state machine in the [billing runbook](./billing-ops-runbook.md#6-organisation-dissolution-reconciliation). |
| OP-014 | P1          | PAYG has no one-per-cycle soft alert or founder-approved maximum beta exposure.  | Add the soft warning first; decide a hard circuit breaker only from real spend and support data.                                                                                               |
| OP-015 | P1          | Non-English product catalogues have not had native-speaker review.               | Review de-CH, fr-CH, es-ES, pt-PT and it-CH; record sign-off in the [i18n guide](./i18n.md).                                                                                                   |

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
| OP-021 | P1 quality | Generated DOCX, PDF and XLSX output needs a current Word, LibreOffice, Pages and Google Docs compatibility pass.                     | Run a synthetic manual matrix and retain dated results before calling exports polished.                                          |
| OP-022 | P2         | The browser document tool loop and later sandboxed code/PPTX/Typst ideas are unbuilt.                                                | Prove live Requesty tool-call transport first. Keep sandboxed code and extra formats as separate, optional decisions.            |
| OP-023 | P2         | Attachments are Account-owned; there is no shared Project file library.                                                              | Write a fresh scoped-file security proposal before building shared files; do not reuse the personal Library model implicitly.    |
| OP-024 | P2         | Redaction still needs a first-run explainer, broader multilingual corpus, chunked large-input detection and optional local counters. | Ship the explainer and corpus quality first; add chunking before raising Attachment limits; keep counters local and counts-only. |
| OP-025 | P1         | Participant Redaction-key wrapping, Temporary Conversation hydration and mapping-write failure handling remain incomplete.           | Add wrapping to participant flows; persist mappings before durable Messages when possible; test every viewer and failure path.   |

The Comprehensive server-assisted Redaction mode stays disabled. It requires a separate privacy
design before implementation.

## Models and Providers

| ID     | Priority | Open point                                                                                                                                | Recommendation                                                                                                                   |
| ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| OP-026 | P2       | Passkeys are not implemented, and their first-factor versus MFA role is undecided.                                                        | Decide role, relying-party/origin policy and recovery first. Passkeys must never replace the Account Key.                        |
| OP-027 | P2       | Model-picker Auto mode is unbuilt.                                                                                                        | Defer until evidence shows Account holders cannot choose; any rules should be local, deterministic and explainable.              |
| OP-028 | P2       | Custom or self-hosted Model endpoints are unbuilt.                                                                                        | Run discovery before design because this changes plaintext routing, trust, billing, network access and support boundaries.       |
| OP-029 | P1       | Requesty has not confirmed whether Vertex grounding fees are billed, and some Provider-family web-search behaviour lacks live validation. | Keep the configured search floor; get written fee confirmation and run only the Provider-family spikes needed by actual routing. |
| OP-030 | P1       | Gemini image transport/cost needs a gated live test; size, aspect and quality controls are absent.                                        | Validate transport and operator pricing before enabling the Model. Defer controls until demand is clear.                         |

Infomaniak search, rich source previews, audio transcription and Project Personas are not approved
roadmap items. Drop them unless customer evidence brings them back.

## Product and infrastructure review

| ID     | Priority          | Open point                                                                                          | Recommendation                                                                                                        |
| ------ | ----------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| OP-031 | P2                | Domain verification, SSO and SCIM are unbuilt.                                                      | Treat them as one Enterprise identity programme; require an Account-Key compatibility design before SSO/SCIM.         |
| OP-032 | P2                | Analytics opt-out UI, self-hosting, proxying and revenue properties are optional enhancements.      | Keep the current privacy-preserving interface; revisit only after the production measurement loop works.              |
| OP-033 | P2                | Standalone authenticated Conversation-sharing UI is absent although backend Participant APIs exist. | Build only if product research prefers it alongside Public shares and Team Projects.                                  |
| OP-034 | P1 quality        | Conversation-import adapters need synthetic fixtures from current ChatGPT and Claude exports.       | Refresh fixtures, verify adapters, then run focused and full browser suites.                                          |
| OP-035 | P2 infrastructure | Same-origin app/API serving and edge HTTP/2/3 behaviour are not verified.                           | Evaluate same-origin first because it removes connection overhead; treat protocol verification as secondary evidence. |

Refund fulfilment remains operator-driven for beta. Keep the UI explicit that it submits a request;
automate only when volume makes the operational path unreliable.

## Testing debt

| ID     | Priority | Open point                                                                                  | Recommendation                                                                                                                 |
| ------ | -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| OP-036 | P1       | Property-test planning is stale and may duplicate tests already present.                    | Re-scan current coverage; retain only missing high-risk compaction parser/coverage and TypeScript crypto/Redaction properties. |
| OP-037 | P1       | The Account deletion Organisation cases in OP-001 have no regression tests.                 | Add API tests before changing the handler.                                                                                     |
| OP-038 | P2       | Web-search system-message and conditional Vertex Claude paths are not fully live-validated. | Test only families enabled in the catalogue; fail closed for unknown offset/stream shapes.                                     |

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
