---
description: Index of the current business rules enforced by Cognos
name: business-processes-index
---

# Business Processes

Business processes are the source of truth for **current product behaviour**. They own the rule and
its safety boundary; code owns the implementation. A mismatch is a defect, so change both in the
same pull request.

Each file should answer one question quickly:

1. What happens?
2. Who may do it?
3. What must never happen?
4. Where is the rule enforced or tested?

Unshipped ideas and unresolved decisions belong in [`open-points.md`](../open-points.md), not here.
Durable architectural rationale belongs in [ADRs](../adr/README.md). Domain vocabulary follows
[CONTEXT.md](../../CONTEXT.md).

## Identity and Account

- [Signup Trial seed](./signup-trial-seed.md),
  [email verification gate](./email-verification-gate.md),
  [single Account key pair](./single-user-key-pair.md),
  [Account preferences](./account-preferences.md)
- [Email change](./email-change.md), [password reset](./password-reset.md),
  [MFA login](./mfa-login.md), [MFA recovery codes](./mfa-recovery-codes.md)
- [Vault session](./vault-session.md), [logout token rotation](./logout-token-rotation.md),
  [Account deletion](./account-delete.md)

## Conversations

- [Create](./conversation-create.md), [load](./conversation-load.md),
  [activity ordering](./conversation-activity.md), [copy](./conversation-copy.md)
- [Import](./conversation-import.md), [Project membership](./conversation-project-membership.md),
  [retention](./conversation-retention.md), [search index](./conversation-search-index.md)
- [Minimap](./conversation-minimap.md), [Public share](./public-share.md),
  [Participant access](./participant-access-control.md), [add Participant](./participant-add.md)
- [Conversation key rotation](./conversation-key-rotation.md),
  [current key-version reads](./key-version-read-gate.md)

## Messages and private data

- [Message encryption](./message-encryption.md), [Redaction](./pii-redaction.md),
  [Attachment processing](./attachment-processing.md)
- [Bookmarks](./bookmarks.md), [disappearing Message cleanup](./expired-message-cleanup.md),
  [soft-delete retention](./soft-delete-retention.md)

## Projects and Organisations

- [Project management and sharing](./project-management.md),
  [Account and Project memory](./account-memory.md)
- [Organisation lifecycle](./organisation-lifecycle.md),
  [invite links](./org-invite-link.md), [Seat management](./org-seat-management.md)
- [Organisation Project access](./org-project-access.md),
  [Organisation billing](./org-billing.md)

## Completions and Models

- [Completion pipeline](./completion-pipeline.md),
  [Model capability gating](./model-capability-gating.md),
  [privacy-tier gating](./privacy-tier-gating.md)
- [Requesty Model sync](./requesty-model-sync.md),
  [reasoning visibility](./reasoning-visibility.md),
  [reasoning output budget](./reasoning-output-budget.md)
- [Conversation compaction](./conversation-compaction.md), [web search](./web-search.md),
  [grounding redirect resolution](./grounding-redirect-resolution.md)
- [Image generation](./image-generation.md), [document generation](./document-generation.md),
  [Persona management](./persona-management.md)

## Billing, analytics and platform

- [Billing access gate](./billing-access-gate.md),
  [Plan management](./billing-plan-management.md),
  [usage cost calculation](./usage-cost-calculation.md), [usage ledger](./usage-ledger.md)
- [Product analytics](./product-analytics.md),
  [Completion usage emission](./analytics-emit.md)
- [Rate limiting](./rate-limiting.md)
