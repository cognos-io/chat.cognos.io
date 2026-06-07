# Backend Model Selector, Sharing-Ready Messages & Gateway Rework — Living Checklist

**Related docs:**

- `docs/specs/backend-model-selector.md`
- `docs/specs/backend-model-selector-test-plan.md`
- `docs/security-model.md`

This checklist is the living execution tracker for the rework.

---

## Confirmed decisions reflected here

- [x] model catalogue remains backend-driven
- [x] gateway is a Cognos-owned internal abstraction first
- [x] Bifrost is an adapter choice, not the product contract
- [x] conversation encryption is conversation-scoped and built for future sharing now
- [x] threading must be preserved
- [x] expiring-message behaviour must be preserved
- [x] billing records ship now, but balances/plan changes are manually updated by the operator
- [x] usage tracking should capture input/output/cache/provider-cost fields where available
- [x] browser E2E is required from the start, but only at a high behavioural level

---

## Success criteria

- frontend renders models from the backend, not hard-coded lists
- chat requests use first-party Cognos endpoints only
- only approved Infomaniak models are active in the first cut
- message content is stored as ciphertext only
- conversation encryption is participant-based and sharing-ready
- threading and expiry still work after the rewrite
- billing records token usage and cost metadata without storing plaintext content
- new-device unlock requires password + Account Key
- trusted devices can stay unlocked locally
- README/docs match the implemented security model

---

## Phase 0 — Prep and safety checks

### Docs

- [x] `docs/specs/backend-model-selector.md`
    - [x] updated to reflect gateway-first, sharing-ready, threading/expires, and manual-billing
          decisions
- [x] `docs/specs/backend-model-selector-checklist.md`
    - [x] rewritten as the living tracker for this branch
- [x] `docs/specs/backend-model-selector-test-plan.md`
    - [x] added detailed red/green plan covering backend, frontend, and browser E2E
- [ ] `docs/security-model.md`
    - [ ] keep in sync if implementation details change
- [ ] `README.md`
    - [ ] keep wording aligned during rollout
- [ ] `backend/README.md`
    - [ ] update/remove legacy notes once replaced

### Verification baseline

- [x] identify current branch
    - [x] current branch is `feat/llm-gateway`
- [ ] confirm current branch is the intended branch for this rework
- [x] run backend tests before changes
    - [x] `cd backend && go test ./...` passes
- [x] run frontend unit tests before changes
    - [x] initial baseline failure recorded and resolved
    - [x] `cd frontend && pnpm exec ng test --watch=false` now passes
- [x] run frontend build before changes
    - [x] initial baseline failure recorded and resolved
    - [x] `cd frontend && pnpm build` now passes
    - [x] remaining component-style budget warnings are non-blocking follow-up work

---

## Phase 1 — Test harness and red/green foundation

### New docs / harness work

- [ ] `docs/specs/backend-model-selector-test-plan.md`
    - [ ] keep updated as tests are added and moved from red → green
- [x] browser E2E harness
    - [x] choose/install the browser E2E runner
    - [x] document the canonical local command
    - [x] run app(s) on non-standard local ports for E2E

### Backend test targets

- [x] backend integration tests for `/api/v1/models`
    - [x] active model list
    - [x] eligibility metadata
    - [x] privacy-tier behaviour
- [x] gateway contract tests
    - [x] initial package-level gateway contract and mock-client tests added
    - [x] completion API tests now depend on a mock gateway client
- [x] catalogue unit tests
    - [x] tier filtering
    - [x] inactive exclusion
    - [x] lookup by ID

### Frontend test targets

- [x] frontend unit test baseline is green again
- [x] high-level browser E2E baseline is green
    - [x] authenticated user loads models from backend

### Verification

- [x] backend unit/integration tests pass for catalogue and models API
- [x] frontend unit tests pass
- [x] first browser E2E passes

---

## Phase 2 — Backend model catalogue and gateway contract

### Backend packages/files

- [ ] `backend/internal/catalogue/models.go`
    - [ ] keep code-defined catalogue as source of truth
    - [ ] only approved Infomaniak model(s) active initially
    - [ ] retain eligibility metadata needed by the UI
- [ ] `backend/internal/catalogue/models_test.go`
    - [ ] expand tier/eligibility coverage if needed
- [x] `backend/internal/gateway/client.go`
    - [x] define Cognos-owned request/response/interface contract
    - [x] include input/output/cache/provider-cost usage fields
- [x] `backend/internal/gateway/mock_client.go`
    - [x] deterministic test double for handler/service tests
- [ ] `backend/internal/gateway/bifrost.go`
    - [ ] add as adapter behind the interface when ready
- [ ] `backend/internal/gateway/bifrost_test.go`
    - [ ] guarded real-adapter path if practical
- [ ] `backend/internal/handler/models.go`
    - [ ] keep `GET /api/v1/models`
    - [ ] return all active models plus eligibility metadata

### Existing backend files to update

- [ ] `backend/internal/config/api.go`
    - [ ] add config cleanly for gateway adapters and Infomaniak product ID
- [x] `backend/cmd/api/main.go`
    - [x] wire gateway interface and adapter(s)
- [x] `backend/cmd/api/routes.go`
    - [x] keep first-party model/chat routes consistent

### Verification

- [ ] request to `/api/v1/models` returns backend-driven models
- [ ] handlers/services no longer depend on provider SDK types directly
- [ ] only approved Infomaniak model(s) are active

---

## Phase 3 — Sharing-ready conversations and messages rewrite

### New backend packages/files

- [ ] `backend/internal/store/conversations.go`
    - [ ] conversation persistence helpers
    - [ ] key version support
- [ ] `backend/internal/store/messages.go`
    - [ ] message persistence helpers for the new schema
- [ ] `backend/internal/store/participants.go`
    - [ ] participant membership and wrapped conversation key access records
- [ ] `backend/internal/store/interface.go`
    - [ ] minimal interfaces for handler/service tests
- [ ] `backend/internal/handler/conversations.go`
    - [ ] create/list conversations by participant access
    - [ ] list messages preserving thread/expiry metadata
- [ ] `backend/internal/handler/complete.go`
    - [ ] validate model ID
    - [ ] validate user tier eligibility
    - [ ] validate conversation access
    - [ ] persist user + assistant messages with preserved threading/expiry behaviour

### Crypto files

- [ ] `backend/internal/crypto/payload.go`
    - [ ] define final encrypted payload shape
    - [ ] include usage metadata fields as needed
- [ ] `backend/internal/crypto/encrypt.go`
    - [ ] align with conversation-scoped key architecture
    - [ ] keep NaCl-based approach
- [ ] `backend/internal/crypto/encrypt_test.go`
    - [ ] round-trip tests
    - [ ] invalid key tests
    - [ ] wrapped conversation-key access tests

### Existing backend files to update

- [ ] `backend/internal/auth/repo.go`
    - [ ] support user public-key lookup for participant key wrapping
- [ ] `backend/internal/chat/conversation.go`
    - [ ] adapt/migrate/retire based on new store layer
- [ ] `backend/internal/chat/repo.go`
    - [ ] adapt/migrate/retire based on new store layer
- [ ] `backend/internal/chat/messaging.go`
    - [ ] replace payload assumptions with final encrypted payload model

### PocketBase migrations/schema

- [ ] add/update migrations for:
    - [ ] `users.public_key`
    - [ ] `users.privacy_tier`
    - [ ] `users.preferred_model_id`
    - [ ] `conversations`
    - [ ] `conversation_participants`
    - [ ] `conversation_access_keys`
    - [ ] `messages`
- [ ] ensure server-side rules match first-party API behaviour

### Behaviour that must survive

- [ ] threading preserved
    - [ ] `parent_message_id` persisted and returned
- [ ] expiring-message behaviour preserved
    - [ ] `expires_at` persisted and returned
- [ ] ciphertext-only persistence preserved
- [ ] non-participants cannot read/write the conversation

### Verification

- [ ] create/list conversation works
- [ ] send/reply flow works with preserved thread linkage
- [ ] expiring messages still expire / can still be kept where applicable
- [ ] DB inspection shows no plaintext chat content at rest

---

## Phase 4 — Billing and analytics

### New backend packages/files

- [ ] `backend/internal/billing/service.go`
    - [ ] plan types
    - [ ] affordability check
    - [ ] deduction/record logic
    - [ ] provider-cost precedence when available
- [ ] `backend/internal/billing/fx_rate.go`
    - [ ] cached USD→CHF rate
- [ ] `backend/internal/billing/service_test.go`
    - [ ] PAYG / flat-rate / insufficient-balance coverage
- [ ] `backend/internal/analytics/event.go`
    - [ ] usage event shape
    - [ ] input/output/cache/provider-cost fields
- [ ] `backend/internal/analytics/emitter.go`
    - [ ] buffered event writing
    - [ ] flush strategy
- [ ] `backend/internal/analytics/emitter_test.go`
    - [ ] serialization/flush tests
- [ ] `backend/internal/handler/billing.go`
    - [ ] `GET /api/v1/billing`
    - [ ] `GET /api/v1/billing/transactions`

### New/updated schema

- [ ] add/update migrations for:
    - [ ] `user_billing`
    - [ ] `balance_transactions`

### Existing backend files to update

- [ ] `backend/internal/handler/complete.go`
    - [ ] add preflight affordability check for trial / inactive contract
    - [ ] record usage
    - [ ] emit analytics
- [ ] `backend/cmd/api/main.go`
    - [ ] wire billing/emitter services

### Manual-operations note

- [ ] operator/admin path exists to:
    - [ ] set/change plan type manually
    - [ ] inspect billing transactions manually
    - [ ] grant or adjust trial credit manually

### Verification

- [ ] trial/inactive affordability gate test passes
- [ ] PAYG/unlimited usage recording path passes without blocking
- [ ] analytics payload excludes plaintext content and direct user identifiers
- [ ] input/output/cache/provider-cost fields are recorded as supported by the active provider

---

## Phase 5 — Frontend model selector and chat integration

### Existing frontend files to update

- [ ] `frontend/src/app/interfaces/model.ts`
    - [ ] keep only client schema/types, not source-of-truth catalogue data
- [ ] `frontend/src/app/services/model.service.ts`
    - [ ] fetch models from backend
    - [ ] hold selected model
    - [ ] support eligibility metadata
- [ ] `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts`
    - [ ] render backend-provided model data
    - [x] show unavailable models clearly
- [ ] `frontend/src/app/components/chat/message-list-item/message-list-item.component.ts`
    - [ ] resolve assistant model labels from fetched model data
- [ ] `frontend/src/app/services/message.service.ts`
    - [ ] align with final complete response schema
    - [ ] keep thread and expiry behaviour intact
- [ ] `frontend/src/app/services/conversation.service.ts`
    - [ ] align conversation access-key handling with final backend schema
- [ ] `frontend/src/app/services/crypto.service.ts`
    - [ ] align decryption helpers with final conversation-scoped key format

### Verification

- [ ] no hard-coded model list is required for normal operation
- [ ] UI shows all active models
- [x] UI distinguishes selectable vs unavailable models
- [x] send/reply flow still renders decrypted history correctly
- [ ] thread/expiry UX still behaves correctly

---

## Phase 6 — Browser E2E coverage

### Required high-level scenarios

- [x] authenticated user loads models from backend
- [x] authenticated user creates or opens a conversation
- [x] authenticated user sends a message and receives a response
- [x] conversation history reload still works
- [x] trial/inactive billing restriction blocks sending
- [x] unavailable model cannot be selected/sent

### Explicit non-goals for these tests

- [ ] do not assert CSS classes unnecessarily
- [ ] do not test visual styling details
- [ ] do not over-specify animations or layout minutiae

### Verification

- [x] canonical browser E2E command passes locally
- [ ] browser E2E is stable enough for CI use

---

## Phase 7 — Legacy path removal

### Backend

- [ ] `backend/pkg/compat/openai/openai.go`
    - [ ] remove once fully replaced
- [ ] `backend/pkg/proxy/*`
    - [ ] remove provider adapters no longer used
- [ ] `backend/db/migrations/1711007996_created_models.go`
    - [ ] decide whether legacy `models` collection is retired or left unused

### Frontend

- [ ] remove any remaining obsolete chat transport or model fallback paths

### Verification

- [ ] repo-wide search shows no active chat-path dependency on the legacy compatibility layer

---

## Phase 8 — Documentation and final wording pass

### Docs to update

- [ ] `README.md`
    - [ ] final wording after implementation lands
- [ ] `backend/README.md`
    - [ ] remove legacy notes once obsolete
- [ ] `docs/security-model.md`
    - [ ] update with final implemented details
- [ ] `docs/specs/backend-model-selector.md`
    - [ ] mark any decisions that changed during implementation
- [ ] `docs/specs/backend-model-selector-test-plan.md`
    - [ ] final pass so it matches the implemented suite

### Verification

- [ ] no README/doc claims the private key never leaves the device
- [ ] docs accurately describe Account Key behaviour
- [ ] docs accurately describe conversation sharing readiness
- [ ] docs match real API paths and model source of truth

---

## Useful repo-wide searches during implementation

- [ ] search legacy model usage

```bash
rg -n "hardCodedModels|defaultModel|provider:model|selectedModel\(" backend frontend
```

- [ ] search legacy transport / provider coupling

```bash
rg -n "chat\.completions|OpenAI|/v1/chat/completions|sashabaranov|go-openai" \
  backend frontend
```

- [ ] search conversation/thread/expiry assumptions

```bash
rg -n "parent_message|expires|conversation_public_keys|conversation_secret_keys|wrapped_key|privacy_tier" \
  backend frontend
```

- [ ] search risky wording

```bash
rg -n "private key never leaves|vault password|OpenAI-compatible" \
  README.md backend/README.md docs
```

---

## Final release checklist

- [ ] backend tests pass
- [ ] frontend unit tests pass
- [ ] frontend build passes
- [ ] browser E2E passes
- [ ] integration smoke tests pass
- [ ] schema migrations apply cleanly on a fresh DB
- [ ] no plaintext chat content stored at rest
- [ ] threading and expiry still work
- [ ] conversation encryption is participant-based and sharing-ready
- [ ] billing records and analytics fields are complete for active providers
- [ ] only approved Infomaniak model(s) are active
- [ ] docs are updated and internally consistent
