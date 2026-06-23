# Reasoning Visibility — Product & Architecture Spec

**Status:** MVP implemented (streaming disclosure shipped on `feat/reasoning-tokens`)  
**Scope:** Show provider-returned reasoning artefacts in chat responses without weakening Cognos'
privacy model.  
**Related docs:**

- `docs/security-model.md`
- `docs/business_processes/completion-pipeline.md`
- `docs/specs/backend-model-selector.md`
- `docs/specs/pii-redaction.md`

## 0. Decision Summary

Cognos will display **reasoning artefacts only when they are explicitly returned by the provider as
user-visible output or safe reasoning summaries**. Cognos will not claim to expose a model's hidden
chain-of-thought, because most providers do not expose it and raw hidden reasoning can contain
unsafe, misleading, private, or policy-sensitive content.

For the MVP, the feature is a transparency panel attached to assistant messages:

- final answer remains the primary message content;
- optional provider-returned reasoning appears in a collapsed “Reasoning” disclosure;
- optional reasoning token counts appear in usage/cost metadata;
- all persisted reasoning text is encrypted as part of the assistant message payload;
- plaintext reasoning text is never logged, written to analytics, or stored in billing records.

The product language must say **“Reasoning supplied by the model”**, not “proof”, “truth”, or
“exact thought process”.

## 0.1 Implementation status (MVP)

The streaming reasoning disclosure is implemented end-to-end:

- **Gateway** (`internal/gateway`): `CompleteResponse.Reasoning`,
  `CompleteStreamEvent.ReasoningDelta`, and `Usage.ReasoningTokens` carry reasoning. The Bifrost
  adapter maps the provider-normalised `reasoning` field (it already folds OpenAI/xAI/DeepSeek
  shapes into one) and `completion_tokens_details.reasoning_tokens`.
- **API** (`internal/handler/complete.go`): a `reasoning_delta` SSE event streams reasoning
  separately from `delta`; reasoning is persisted inside the encrypted `MessageRecordData` and
  surfaced on the terminal `complete` response plus `usage.reasoning_tokens`. Reasoning text reaches
  no log, billing ledger, or analytics record — only the numeric token count is plumbed.
- **Frontend**: `MessageData.reasoning` (zod), a `reasoning_delta` stream event, an accumulator that
  keeps reasoning out of `content`, and a subtle inline "Show reasoning" disclosure that streams
  live while the response generates and collapses once complete. Strings are translated in all six
  locales.

Decisions taken for the MVP that refine this spec:

- Reasoning is stored as a **plain string**, not the nested `{format, text, blocks}` object in
  §6.3/§7. Bifrost gives a single normalised reasoning string, so the simpler shape matches the real
  data source. The `version` field on the payload allows promoting to a structured form later.
- **Token-count UI (§6.6)** is deferred: `reasoning_tokens` flows through the API and is available
  on the frontend `CompleteResponse`, but no usage label renders it yet.
- **Model catalogue capability (§6.5)** uses the existing `reasoning` capability **tag** (already
  mapped to the frontend model selector as a badge) rather than a new capability enum.
- The `[reason]` sentinel in the mock AI provider drives the e2e reasoning path offline.

Still open (tracked in §11–§12): the capability enum with `raw_provider_trace`, fallback reasoning
pricing, and the public-share / export review.

## 1. Problem Statement

Users want to understand why an AI response was produced and whether they can trust it. Today Cognos
shows only the final assistant answer plus usage/cost metadata. When a model or provider returns a
reasoning summary, thinking block, or reasoning-token usage count, Cognos drops that information.

Cost of not solving it:

- users cannot inspect available reasoning context inside Cognos;
- model differences feel opaque;
- reasoning-capable models provide less visible value;
- users may wrongly assume Cognos hides useful transparency metadata.

Trust problem to avoid: exposing raw or implied hidden chain-of-thought as if it were a faithful
record of model cognition. The UI must be clear that reasoning artefacts are model-generated output
and may be incomplete or wrong.

## 2. Target Audience

Primary users:

- Cognos chat users who want more transparency into model answers.
- Power users comparing reasoning-capable models.
- Privacy-conscious users who want transparency without plaintext persistence.

Secondary users:

- Operators maintaining the model catalogue and provider adapters.
- Support/debugging staff who need non-content usage metadata such as reasoning token counts.

## 3. Goals

- Preserve and display provider-returned, user-visible reasoning artefacts when available.
- Show reasoning token counts when providers report them.
- Encrypt persisted reasoning text with the assistant message.
- Avoid logging, analytics, billing, or durable plaintext storage of reasoning text.
- Make model support explicit in the backend model catalogue and frontend model selector.
- Keep the UI honest: reasoning is an aid to inspection, not proof of correctness.
- Add tests that prove reasoning text is streamed, rendered, encrypted at rest, and excluded from
  logs/analytics/billing.

## 4. Non-goals

- Exposing hidden chain-of-thought that providers do not explicitly return.
- Inferring or fabricating reasoning after the fact.
- Enabling extra paid reasoning modes by default when a provider charges more or increases latency.
- Using reasoning text for analytics, support search, moderation dashboards, or billing labels.
- Making reasoning visible in public shares before the sharing/export implications are explicitly
  reviewed.
- Reworking the full message encryption model.

## 5. Definitions

| Term                        | Meaning                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Final answer**            | The assistant response shown as normal chat content.                                                                                        |
| **Reasoning artefact**      | Provider-returned text or structured blocks intended to explain or summarise reasoning.                                                     |
| **Reasoning token count**   | Numeric usage metadata for tokens spent on reasoning/internal thinking. This is not the reasoning text.                                     |
| **Hidden chain-of-thought** | Internal model reasoning not exposed by the provider. Cognos must not claim to show this.                                                   |
| **Reasoning support**       | A model/provider capability saying whether Cognos may receive reasoning summaries, raw user-visible thinking blocks, token counts, or none. |

## 6. Core Features

### 6.1 Reasoning display panel

- **User Story:** As a user, I want to open a reasoning panel on answers that include provider
  reasoning so that I can inspect extra context without cluttering the chat.
- **Priority:** P0
- **Acceptance Criteria:**
    - Messages with reasoning show a collapsed, accessible “Reasoning” disclosure.
    - Messages without reasoning do not show an empty panel.
    - The panel shows provider-returned reasoning text/blocks.
    - Existing markdown rendering and safety redaction still apply.
    - The panel says: “Reasoning supplied by the model. It may be incomplete or incorrect.”
    - The final answer remains visible when reasoning is collapsed.
    - UI strings are translated through the existing i18n flow.

### 6.2 Streaming reasoning events

- **User Story:** As a user, I want reasoning to appear while a reasoning-capable response streams
  so that the interface feels transparent during longer generations.
- **Priority:** P0 if provider streaming exposes reasoning; otherwise P1.
- **Acceptance Criteria:**
    - SSE supports a `reasoning_delta` event, separate from answer deltas.
    - Answer deltas continue to reconstruct `assistant_message.content`.
    - Reasoning deltas reconstruct the final encrypted reasoning payload.
    - Clients that ignore unknown event types still receive the final answer.
    - Stream errors never include prompt, answer, or reasoning plaintext.

Suggested SSE shape:

```json
{"type":"reasoning_delta","delta":"First, I check the constraints..."}
```

Terminal `complete` responses include reasoning only when present.

### 6.3 Encrypted reasoning persistence

- **User Story:** As a privacy-conscious user, I want reasoning to receive the same
  encrypted-at-rest treatment as assistant answers so that transparency does not weaken privacy.
- **Priority:** P0
- **Acceptance Criteria:**
    - Reasoning text is stored only inside the encrypted assistant message payload.
    - PocketBase plaintext columns do not contain reasoning text.
    - Analytics events do not contain reasoning text.
    - Billing ledger rows store numeric reasoning token counts only.
    - Message deletion and soft-delete clear reasoning text with message content.
    - Export/share behaviour is reviewed before exposing reasoning outside normal chat.

Suggested decrypted message payload addition:

```json
{
  "version": "1",
  "content": "Final assistant answer",
  "reasoning": {
    "format": "provider_summary_v1",
    "text": "Provider-returned reasoning summary",
    "blocks": [
      { "type": "summary", "text": "Provider-returned block" }
    ]
  }
}
```

### 6.4 Gateway support

- **User Story:** As an operator, I want reasoning handling centralised in the gateway abstraction
  so provider-specific response shapes do not leak into handlers.
- **Priority:** P0
- **Acceptance Criteria:**
    - `gateway.CompleteResponse` can carry optional reasoning text/blocks.
    - `gateway.CompleteStreamEvent` can carry optional reasoning deltas.
    - `gateway.Usage` can carry optional/numeric `ReasoningTokens`.
    - Provider adapters map only documented provider fields.
    - Unknown provider reasoning fields are ignored until mapped and tested.
    - Gateway tests cover no reasoning, summaries, deltas, token counts, and safe errors.

### 6.5 Model catalogue capability

- **User Story:** As a user, I want to know which models may show reasoning so that model selection
  is less opaque.
- **Priority:** P0
- **Acceptance Criteria:**
    - The backend model catalogue exposes a reasoning capability for every active model.
    - The frontend model type maps that capability.
    - The model selector can show a “Reasoning” badge for supported models.
    - Capability values distinguish:
        - `none` — no reasoning artefacts expected;
        - `token_count` — numeric counts only;
        - `summary` — provider-returned summary/text may be shown;
        - `raw_provider_trace` — user-visible thinking blocks behind a feature flag.
    - Capability does not bypass privacy-tier, billing, or eligibility checks.

### 6.6 Usage and billing metadata

- **User Story:** As a user, I want reasoning token counts included in usage information when
  available so that cost feels understandable.
- **Priority:** P1
- **Acceptance Criteria:**
    - API usage responses include `reasoning_tokens`, defaulting to `0`.
    - Cost calculation continues to prefer provider-reported cost.
    - Fallback cost calculation includes documented reasoning-token pricing.
    - Billing ledger metadata stores numeric token/cost fields only.
    - UI labels make clear reasoning tokens are counts, not inspectable text.

## 7. API Contract

### 7.1 Completion response

Add optional reasoning to the terminal completion response:

```json
{
  "assistant_message": {
    "id": "msg_123",
    "content": "Final answer",
    "reasoning": {
      "format": "provider_summary_v1",
      "text": "Reasoning supplied by the model"
    },
    "model_id": "model-id",
    "created_at": "2026-06-23T12:00:00Z"
  },
  "usage": {
    "input_tokens": 100,
    "output_tokens": 80,
    "reasoning_tokens": 24,
    "total_tokens": 204
  }
}
```

### 7.2 Stream events

Supported stream event types after this change:

- `delta` — final-answer text delta; unchanged.
- `reasoning_delta` — reasoning text delta; new.
- `complete` — final response containing answer, optional reasoning, and usage.
- `error` — user-safe error; unchanged.

### 7.3 Message list response

No plaintext reasoning field is added to `MessageRecord`. Persisted reasoning is only inside the
encrypted `data` blob and appears after client-side decryption.

## 8. Security & Privacy Requirements

- Reasoning text is treated as assistant content.
- Reasoning text must be encrypted before durable persistence.
- Reasoning text must not be logged, even at debug level.
- Provider raw JSON containing reasoning must not be stored unless the entire persisted object is
  encrypted message data.
- Analytics must store only non-content metadata such as model ID, token counts, cost, and plan
  type.
- Public sharing, exports, and copy actions must not expose reasoning accidentally. Each surface
  needs an explicit product decision before launch.
- The UI must not imply reasoning is authoritative or complete.
- If a provider returns unsafe or malformed reasoning, Cognos may omit the reasoning panel while
  still showing the final answer.

## 9. Success Metrics

Measure after release:

- At least **20%** of assistant messages from reasoning-capable models have the reasoning panel
  opened within 30 days of launch.
- Fewer than **1%** of completion requests fail due to reasoning parsing errors.
- **0** occurrences of reasoning plaintext in application logs, analytics payloads, billing ledger
  metadata, or plaintext PocketBase columns in automated leak tests.
- Support tickets mentioning “why did it answer this?” decrease by **10%** among users of
  reasoning-capable models within 60 days, if baseline ticket volume is sufficient.

## 10. Testing Plan

Follow red/green development with high-level tests first.

### API e2e tests

- A stubbed reasoning-capable model streams `reasoning_delta` events and a final `complete` event.
- The final response includes `assistant_message.reasoning` when provider reasoning exists.
- A model without reasoning returns the existing response shape plus `reasoning_tokens: 0`.
- Persisted messages store reasoning only in encrypted `data`, not plaintext columns.
- Analytics and billing records contain numeric counts only.
- Provider errors do not leak reasoning text.

### Browser e2e tests

- A reasoning-capable assistant response renders a collapsed “Reasoning” disclosure.
- Opening the disclosure shows the reasoning text.
- Messages without reasoning do not render the disclosure.
- Streaming reasoning updates the disclosure without mixing into final answer text.
- Copying the final answer copies only final answer text unless an explicit “copy reasoning” action
  exists.

### Unit tests

- Gateway provider mapping for each supported provider shape.
- Complete response mappers in frontend and backend.
- `MessageData` schema parsing with and without `reasoning`.
- i18n key coverage for all supported locales.

## 11. Rollout Plan

1. **Backend contract behind tests**
   - Add gateway reasoning fields and API e2e coverage.
   - Verify no plaintext persistence/logging.
2. **Frontend rendering**
   - Add message schema, stream event parsing, and collapsed panel UI.
   - Verify browser e2e rendering and copy behaviour.
3. **Catalogue + model badges**
   - Add reasoning capability metadata per active model.
   - Show badges only where support is known.
4. **Provider-specific mappings**
   - Enable one provider/model family at a time.
   - Keep unknown provider fields ignored until tested.
5. **Public share/export review**
   - Decide whether reasoning is hidden, included by default, or controlled by an explicit toggle.

## 12. Open Questions

- Which provider/model should be the first supported reasoning-visible path?
- Should Cognos ever request additional paid reasoning output automatically, or only display
  reasoning already returned by the selected model?
- Should public shared conversations include reasoning when the owner shares a message?
- Should exports include reasoning by default, behind a checkbox, or never?
- Should `raw_provider_trace` remain internal/admin-only until there is a provider-by-provider
  safety review?
