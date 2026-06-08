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

  FE->>H: messages, model_id, agent_id
  H->>H: validate body, lookup model, agent
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
    H->>H: CalculateCost (provider × 1.20 × FX → rappen)
    H->>L: RecordUsage (balance_transactions row)
    H->>A: Emit usage event (buffered)
    H-->>FE: 200 with content + usage
  end
```

Three invariants the handler holds across that flow:

1. **No paid gateway call without authorisation.** Participants check and
   billing gate both run before the upstream provider is touched. A
   non-participant or unfunded user sees `404` / `402` respectively, with
   zero provider cost.
2. **No orphan user message.** If the gateway call fails after the user
   message is persisted, the handler deletes that message before
   returning `503` so the conversation never carries an unanswered prompt.
3. **Best-effort billing + analytics.** Ledger and analytics writes happen
   after the success response is computed; failures are logged but do not
   fail the request — the user has already received the answer they paid
   for, and re-running cost arithmetic from existing artefacts is possible.
