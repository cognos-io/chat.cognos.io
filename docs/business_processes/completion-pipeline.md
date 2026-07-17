---
description: End-to-end shape of a chat completion — auth, access, billing gate, persist, gateway, persist, ledger, analytics
name: completion-pipeline
---

# Completion Pipeline

`POST /api/v1/completions` (free) and
`POST /api/v1/conversations/{id}/complete` (persisting) run the same
sequence. The persisting path adds the participant check and writes user +
assistant messages around the gateway call.

```mermaid
sequenceDiagram
  autonumber
  participant FE
  participant H as /complete handler
  participant DB
  participant GW as Gateway client
  participant L as Ledger
  participant A as Analytics

  FE->>H: messages, model_id, persona_id, system_prompt
  H->>H: validate body, lookup model, inject persona prompt
  Note over H: capability gate<br/>(see model-capability-gating)
  Note over H: privacy_tier check<br/>(see privacy-tier-gating)
  alt conversation path
    H->>DB: participants.IsActive ➜ 404 if not
    H->>DB: load conversation + key
  end
  H->>H: billing access gate<br/>(see billing-access-gate)
  alt persisting
    H->>DB: encrypt + INSERT user message
  end
  H->>GW: provider call
  GW-->>H: usage + content
  alt gateway failed
    H->>DB: DELETE user message (cleanup)
    H-->>FE: 503
  else
    alt persisting
      H->>DB: encrypt + INSERT assistant message
    end
    H->>H: CalculateCost (Provider × 1.22 × FX → Rappen)
    H->>L: RecordUsage (balance_transactions row)
    H->>A: Emit usage event (buffered)
    H-->>FE: 200 with content + usage
  end
```

Three invariants the handler holds across that flow:

1. **No paid gateway call without authorisation.** Participants check and
   billing gate both run before the upstream Provider is touched. A
   non-participant or unfunded Account holder sees `404` / `402` respectively,
   with zero Provider cost.
2. **No orphan user message.** If the gateway call fails after the user
   message is persisted, the handler deletes that message before
   returning `503` so the Conversation never carries an unanswered prompt.
3. **Best-effort billing + analytics.** Ledger and analytics writes happen
   after the success response is computed; failures are logged but do not
   fail the request — the Account holder has already received the answer they
   paid for, and re-running cost arithmetic from existing artefacts is possible.

## Attachments

When a completion references library files (`attachment_ids` /
`attachment_contexts`), the handler:

- **verifies the caller _owns_ each referenced file** (`user_attachments.owner ==
  caller`) before the gateway call — a pre-provider authorisation gate alongside
  the participant and billing checks; a foreign id is `400` with zero provider cost;
- wraps the (already client-redacted) attachment text as **untrusted** content,
  appends it to the user turn, and counts it in the billing-gate token estimate so
  large attachments can't bypass the gate;
- on the persisting path, embeds `user_upload` references inside the **encrypted**
  user message and records an `attachment_usages` row per `(file, message)` — it
  never persists the plaintext attachment context;
- re-sends context for attachments referenced earlier in the thread (excluding any
  folded into a compaction summary) so a stateless model keeps seeing them.

Full lifecycle, encryption scope and security: [attachment-processing](./attachment-processing.md).
