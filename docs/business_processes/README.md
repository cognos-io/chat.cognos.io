---
description: Map of small, self-contained business processes used by the Cognos chat backend
name: business-processes-index
---

# Business Processes

Each file in this directory captures **one** business process that the backend
enforces — short enough to read in under a minute, long enough to answer
"what does this rule actually do, and why?".

If a process touches >1 file, the doc owns the **rule**; the code owns the
**how**. When in doubt, the code is authoritative.

| Area          | Process                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | [signup-trial-seed](./signup-trial-seed.md) · [single-user-key-pair](./single-user-key-pair.md) · [email-change-blocked](./email-change-blocked.md) · [password-reset-blocked](./password-reset-blocked.md) · [logout-token-rotation](./logout-token-rotation.md) · [vault-session](./vault-session.md) |
| Conversations | [conversation-create](./conversation-create.md) · [participant-access-control](./participant-access-control.md) · [participant-add](./participant-add.md) · [conversation-key-rotation](./conversation-key-rotation.md) · [key-version-read-gate](./key-version-read-gate.md)                           |
| Messaging     | [message-encryption](./message-encryption.md) · [expired-message-cleanup](./expired-message-cleanup.md)                                                                                                                                                                                                 |
| Completions   | [completion-pipeline](./completion-pipeline.md) · [privacy-tier-gating](./privacy-tier-gating.md) · [billing-access-gate](./billing-access-gate.md) · [usage-cost-calculation](./usage-cost-calculation.md) · [usage-ledger](./usage-ledger.md) · [analytics-emit](./analytics-emit.md)                 |
| Platform      | [rate-limiting](./rate-limiting.md) · [soft-delete-retention](./soft-delete-retention.md)                                                                                                                                                                                                               |
