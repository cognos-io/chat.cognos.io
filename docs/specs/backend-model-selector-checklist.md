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
- [x] auth/login hot-path unit coverage
    - [x] register + forgot-password links render on the login page
    - [x] valid submit emits the login request
    - [x] authenticated-user redirect back to chat is covered
- [x] auth/register hot-path unit coverage
    - [x] password-mismatch validation is covered directly
    - [x] valid submit emits the register request
    - [x] loading resets on register failure
    - [x] authenticated-user redirect back to chat is covered
- [x] auth service hot-path unit coverage
    - [x] rejected login transitions into the error state with user-facing alerting
    - [x] valid auth-store updates populate success state and remembered email
    - [x] stale-session refresh redirects to logout on 401
    - [x] register chains account creation into sign-in with matching password confirm
    - [x] logout clears trusted unlock state even when the server logout request fails
- [x] trusted unlock hot-path unit coverage
    - [x] local encrypted unlock blobs are written only after wrap-key persistence succeeds
    - [x] unlock keys round-trip through local storage plus server-held wrap keys
    - [x] failed wrap-key fetches invalidate stale local blobs
    - [x] logout-style cleanup removes all trusted-unlock blobs even on server delete failure
- [x] user preferences hot-path unit coverage
    - [x] encrypted preferences hydrate after the key pair becomes available
    - [x] pin conversation deduplicates IDs before persisting
    - [x] unpin conversation removes IDs from the persisted payload
- [x] crypto hot-path unit coverage
    - [x] constant-time byte comparison rejects mismatched lengths and content
    - [x] box and secretBox round-trip encryption paths are covered
    - [x] tampered ciphertext and wrong-key decryption failures are covered
- [x] vault key-pair integrity unit coverage
    - [x] missing record mac is rejected before secret-key decryption
    - [x] mismatched record mac is rejected before secret-key decryption
- [x] high-level browser E2E baseline is green
    - [x] authenticated user loads models from backend
    - [x] auth route-link regression re-verified green after the login-page fix

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

- [x] `backend/internal/config/api.go`
    - [x] add config cleanly for gateway adapters and Infomaniak product ID
    - [x] env provider now maps `COGNOS_<SECTION>_<REST>` → `<section>.<rest>` so runtime
        overrides actually populate the struct
    - [x] env-loading regression coverage in `api_load_test.go`
- [x] `backend/cmd/api/main.go`
    - [x] wire gateway interface and adapter(s)
- [x] `backend/cmd/api/routes.go`
    - [x] keep first-party model/chat routes consistent

### Verification

- [x] request to `/api/v1/models` returns backend-driven models
    - [x] response never leaks provider routing fields (`provider_model_id`, `base_url`, etc.)
- [x] handlers/services no longer depend on provider SDK types directly
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
    - [x] plan types
    - [x] affordability check
    - [x] 20% margin on user-facing cost
    - [x] upper-bound preflight estimate for trial gate
    - [x] plan-aware usage ledger entry builder
    - [x] persistence-backed deduction/record logic
    - [x] provider-cost precedence when available
- [x] `backend/internal/billing/repo.go`
    - [x] PocketBase-backed billing state lookup
    - [x] PocketBase-backed usage ledger writes
    - [x] transactional trial balance update + usage row persistence
    - [x] legacy `flat_rate` → `unlimited` alias on read
    - [x] idempotent trial-state bootstrap for users missing billing rows
- [x] `backend/internal/billing/bootstrap.go`
    - [x] default trial-state seed builder
- [ ] `backend/internal/billing/fx_rate.go`
    - [x] fallback/static USD→CHF provider seam
    - [x] cached USD→CHF rate (wraps any upstream provider; injectable clock + TTL)
- [ ] `backend/internal/billing/service_test.go`
    - [x] cost, margin, and access-policy coverage
    - [x] upper-bound preflight estimate coverage
    - [x] PAYG / unlimited / trial ledger entry coverage
- [ ] `backend/internal/analytics/event.go`
    - [x] usage event shape
    - [x] input/output/cache/provider-cost fields
    - [x] exclude plaintext content and direct user identifiers
- [ ] `backend/internal/analytics/emitter.go`
    - [x] emitter seam / recording emitter
    - [ ] buffered event writing
    - [ ] flush strategy
- [ ] `backend/internal/analytics/emitter_test.go`
    - [x] basic append coverage
    - [ ] serialization/flush tests
- [x] `backend/internal/handler/billing.go`
    - [x] `GET /api/v1/billing`
    - [x] `GET /api/v1/billing/transactions`

### New/updated schema

- [ ] add/update migrations for:
    - [x] `user_billing`
    - [x] `balance_transactions`

### Existing backend files to update

- [ ] `backend/internal/handler/complete.go`
    - [x] support structured billing-restriction handler seam in tests
    - [x] allow PAYG users through the preflight access policy
    - [x] add preflight affordability check for trial / inactive contract
    - [x] record usage via ledger repo seam after successful completions
    - [x] emit analytics via emitter seam after successful completions
- [ ] `backend/cmd/api/main.go`
    - [x] wire billing/emitter services
    - [x] default to PocketBase billing repos when test seams are not provided
    - [x] auto-provision trial billing state for newly created users

### Manual-operations note

- [ ] operator/admin path exists to:
    - [ ] set/change plan type manually
    - [ ] inspect billing transactions manually
    - [ ] grant or adjust trial credit manually

### Verification

- [x] trial/inactive affordability gate test passes
- [x] PAYG/unlimited/trial usage recording path passes without blocking completions
- [x] analytics payload excludes plaintext content and direct user identifiers
- [x] input/output/cache/provider-cost fields are recorded as supported by the active provider
- [x] newly created users receive a trial billing state automatically
- [x] configured trial seed is applied during user billing bootstrap

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
