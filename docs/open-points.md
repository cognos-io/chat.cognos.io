---
description: Single review queue for unresolved Cognos product, security and operational work
last_reviewed: 2026-07-28
name: open-points
---

# Open Points

This queue contains only current launch gates, unresolved integrity or security risks, and external
evidence that blocks a stated claim or release. Missing features and ideas stay out until evidence
gives them priority. Git history preserves removed items.

Runbooks own recurring execution checklists. Business processes describe current behaviour without
turning every deliberate limitation into backlog.

## Launch gates

| ID     | Priority    | Open point                                                                                                | Next action                                                                                                                                                                      |
| ------ | ----------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OP-002 | P0 external | Counsel, Provider retention and data-transfer approval remain unproven.                                   | Keep charging limited to controlled design partners until the [approval checklist](./legal/launch-approval-checklist.md) is signed.                                              |
| OP-003 | P0 external | No retained tagged release bundle proves tests, scans, SBOM and deployed digest.                          | Complete the [release evidence](./operations/release-evidence.md) for every paid release.                                                                                        |
| OP-004 | P0 external | Restore and incident response are documented but not evidenced as rehearsed.                              | Run and date the [restore drill](./operations/restore-drill.md) and [incident tabletop](./operations/incident-response.md).                                                      |
| OP-005 | P0 external | Live Paddle checkout, webhook, refund and first-cycle overage behaviour still need production proof.      | Complete the [billing smoke tests](./billing-ops-runbook.md#14-go-live-smoke-test) and [real PAYG overage gate](./billing-ops-runbook.md#11-first-real-payg-overage-cycle-gate). |
| OP-011 | P0 external | Plausible is provisioned and emission is enabled, but the content-free production smoke is not evidenced. | Run the live [analytics dashboard checklist](./operations/analytics-dashboard.md) and record sign-off.                                                                           |

## Product and security risks

| ID     | Priority | Open point                                                                                                                                                              | Next action                                                                                                                                                             |
| ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OP-013 | P1       | Organisation dissolution can succeed in Paddle and then fail locally.                                                                                                   | Before self-serve Teams, replace the synchronous flow with the [persisted retryable state machine](./billing-ops-runbook.md#6-organisation-dissolution-reconciliation). |
| OP-025 | P1       | Redaction lacks reliable Participant key wrapping, Temporary Conversation hydration, durable mapping writes, first-run guidance, broad multilingual tests and chunking. | Fix the security-sensitive flows first, then add the explainer, corpus coverage and chunking before raising Attachment limits.                                          |
| OP-039 | P2       | Cognos MFA is not challenged on Google OAuth sign-in because the interceptor covers only password authentication.                                                       | Decide whether Google sign-in must satisfy Cognos MFA before making stronger MFA claims. See [MFA login](./business_processes/mfa-login.md).                            |
| OP-028 | P2       | There is no approved custom or self-hosted Model route.                                                                                                                 | Keep the [discovery](./custom-model-hosting-discovery.md) attached and revisit only when a named customer asks for a named Model.                                       |

## External and manual evidence

Do not close these with code-only scaffolding.

| ID     | Priority    | Open point                                                                                                                          | Blocker                                                                                                                            |
| ------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| OP-009 | P1 external | The encryption protocol has no independent penetration test or cryptographic review.                                                | Commission a review and track findings in the [risk register](./security_findings.md) (SR-010).                                    |
| OP-021 | P1 quality  | Generated DOCX, PDF and XLSX output needs a current Word, LibreOffice, Pages and Google Docs compatibility pass.                    | Run a synthetic manual matrix and retain dated results before calling exports polished.                                            |
| OP-029 | P1 external | Requesty has not confirmed Vertex grounding fees, and enabled Provider-family web-search paths still lack complete live validation. | Obtain written fee confirmation and live-test only enabled families, including system-message and conditional Vertex Claude paths. |
| OP-030 | P1 external | The enabled Gemini image route still needs live transport and operator-cost validation.                                             | Gate the Model until a content-free live test confirms transport, Provider pricing and Cognos billing.                             |
