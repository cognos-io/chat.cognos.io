# Backend Model Selector & Security Rework — File-by-File Checklist

**Related docs:**

- `docs/specs/backend-model-selector.md`
- `docs/security-model.md`

This is the execution checklist for the rework.

---

## Success criteria

- frontend renders models from the backend, not hard-coded lists
- chat requests use first-party Cognos endpoints, not the browser OpenAI SDK
- only approved Infomaniak models are active in the first cut
- message content is stored as ciphertext only
- billing records token usage and cost metadata without storing plaintext content
- new-device unlock requires password + Account Key
- trusted devices can stay unlocked locally
- README/docs match the implemented security model

---

## Phase 0 — Prep and safety checks

### Docs

- [ ] `docs/specs/backend-model-selector.md`
    - [ ] confirm decisions remain aligned with implementation before coding
- [ ] `docs/security-model.md`
    - [ ] keep this in sync if implementation details change
- [ ] `README.md`
    - [ ] keep wording aligned during rollout
- [ ] `backend/README.md`
    - [ ] update/remove legacy notes once replaced

### Verification

- [ ] confirm current branch is correct
- [ ] run backend tests before changes
- [ ] run frontend tests/build before changes

---

## Phase 1 — Backend model catalogue and API foundation

### New backend packages/files

- [ ] `backend/internal/catalogue/models.go`
    - [ ] define `PrivacyTier`
    - [ ] define `ContentType`
    - [ ] define `Model`
    - [ ] seed initial Infomaniak model only
    - [ ] implement active/all/lookup helpers

- [ ] `backend/internal/catalogue/models_test.go`
    - [ ] test filtering by tier
    - [ ] test inactive exclusion
    - [ ] test lookup by ID

- [ ] `backend/internal/gateway/bifrost.go`
    - [ ] wrap Bifrost client
    - [ ] configure Infomaniak provider
    - [ ] return normalized completion + usage

- [ ] `backend/internal/gateway/bifrost_test.go`
    - [ ] add guarded integration test path if practical

- [ ] `backend/internal/handler/models.go`
    - [ ] implement `GET /api/v1/models`
    - [ ] return all active models
    - [ ] include user eligibility metadata

### Existing backend files to update

- [ ] `backend/internal/config/api.go`
    - [ ] add new config fields for model/gateway work
    - [ ] add Infomaniak product/config support cleanly
- [ ] `backend/cmd/api/main.go`
    - [ ] wire new config and gateway services
- [ ] `backend/cmd/api/routes.go`
    - [ ] register first-party `/api/v1/models`
    - [ ] begin registering new first-party chat routes

### Legacy/backend cleanup targets

- [ ] `backend/pkg/compat/openai/openai.go`
    - [ ] mark as migration target
    - [ ] remove after replacement path is verified
- [ ] `backend/pkg/proxy/repo.go`
    - [ ] remove or shrink once Bifrost owns provider routing
- [ ] `backend/db/migrations/1711007996_created_models.go`
    - [ ] decide whether legacy `models` collection is retired or left unused

### Verification

- [ ] backend test: catalogue passes
- [ ] request to `/api/v1/models` returns backend-driven models
- [ ] only Infomaniak is active

---

## Phase 2 — Backend conversations/messages API rewrite

### New backend packages/files

- [ ] `backend/internal/store/conversations.go`
    - [ ] first-party conversation persistence helpers
- [ ] `backend/internal/store/messages.go`
    - [ ] message persistence helpers for new schema
- [ ] `backend/internal/store/interface.go`
    - [ ] minimal interfaces for handler/service tests
- [ ] `backend/internal/handler/conversations.go`
    - [ ] `POST /api/v1/conversations`
    - [ ] `GET /api/v1/conversations`
    - [ ] `GET /api/v1/conversations/{id}/messages`
- [ ] `backend/internal/handler/complete.go`
    - [ ] `POST /api/v1/conversations/{id}/complete`
    - [ ] validate model ID
    - [ ] validate user tier eligibility
    - [ ] call gateway
    - [ ] return usage metadata

### Existing backend files to update

- [ ] `backend/cmd/api/routes.go`
    - [ ] register new conversation and complete routes
    - [ ] keep auth/rate-limit behavior consistent
- [ ] `backend/internal/chat/conversation.go`
    - [ ] either adapt into new store layer or retire
- [ ] `backend/internal/chat/repo.go`
    - [ ] either migrate logic into new store layer or retire
- [ ] `backend/internal/chat/messaging.go`
    - [ ] replace payload assumptions with new encrypted payload model

### PocketBase migrations/schema

- [ ] add/update migrations for:
    - [ ] `users.public_key`
    - [ ] `users.privacy_tier`
    - [ ] `users.preferred_model_id`
    - [ ] `conversations`
    - [ ] `messages`
- [ ] ensure server-side rules match new first-party API behavior

### Verification

- [ ] create/list conversation works
- [ ] complete endpoint works with Infomaniak
- [ ] frontend-independent HTTP smoke tests pass

---

## Phase 3 — Encryption payload and ciphertext persistence

### Backend files

- [ ] `backend/internal/crypto/payload.go`
    - [ ] define encrypted payload shape
- [ ] `backend/internal/crypto/encrypt.go`
    - [ ] align with final message encryption format
    - [ ] keep NaCl-based approach
- [ ] `backend/internal/crypto/encrypt_test.go`
    - [ ] round-trip tests
    - [ ] invalid key tests
- [ ] `backend/internal/crypto/encrypt_benchmark_test.go`
    - [ ] keep only if still relevant after final format choice

### Existing backend files to update

- [ ] `backend/internal/auth/repo.go`
    - [ ] support the new public-key and encrypted-backup lookup needs
- [ ] `backend/internal/handler/complete.go`
    - [ ] encrypt persisted user + assistant messages
- [ ] `backend/internal/store/messages.go`
    - [ ] persist ciphertext only

### Verification

- [ ] inspect DB records: no plaintext message content at rest
- [ ] decrypt stored ciphertext in tests successfully
- [ ] confirm logs do not include message content

---

## Phase 4 — Billing and analytics

### New backend packages/files

- [ ] `backend/internal/billing/service.go`
    - [ ] plan types
    - [ ] affordability check
    - [ ] deduction/record logic
- [ ] `backend/internal/billing/fx_rate.go`
    - [ ] cached USD→CHF rate
- [ ] `backend/internal/billing/service_test.go`
    - [ ] PAYG / flat-rate coverage
- [ ] `backend/internal/analytics/event.go`
    - [ ] usage event shape
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
    - [ ] add preflight affordability check
    - [ ] record usage
    - [ ] emit analytics
- [ ] `backend/cmd/api/main.go`
    - [ ] wire billing/emitter services

### Verification

- [ ] PAYG deduction test passes
- [ ] flat-rate path records usage without deduction
- [ ] analytics payload excludes plaintext content and direct user identifiers

---

## Phase 5 — Frontend model selector rewrite

### Existing frontend files to replace/update

- [ ] `frontend/src/app/interfaces/model.ts`
    - [ ] replace hard-coded catalogue as source of truth
    - [ ] keep only client model type/schema if needed
- [ ] `frontend/src/app/services/model.service.ts`
    - [ ] fetch models from backend
    - [ ] hold selected model
    - [ ] support eligibility metadata
- [ ] `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts`
    - [ ] render backend-provided model data
    - [ ] show unavailable models clearly
- [ ] `frontend/src/app/components/chat/message-list-item/message-list-item.component.ts`
    - [ ] ensure assistant model labels still resolve from fetched model list

### Optional frontend API additions

- [ ] create a dedicated API service if needed for models/conversations/billing

### Verification

- [ ] no hard-coded model list is required for normal operation
- [ ] UI shows all active models
- [ ] UI distinguishes selectable vs unavailable models

---

## Phase 6 — Frontend chat transport rewrite

### Existing frontend files to replace/update

- [x] `frontend/src/app/services/openai.service.provider.ts`
    - [x] remove browser OpenAI SDK dependency from the chat path
- [x] `frontend/src/app/services/message.service.ts`
    - [x] replace OpenAI SDK calls with first-party Cognos API calls
    - [x] keep local state/decryption behavior where still valid
    - [x] map new response schema
- [x] `frontend/src/app/services/conversation.service.ts`
    - [x] align conversation CRUD/fetch flow with first-party API
- [x] `frontend/src/app/types/pocketbase-types.ts`
    - [x] regenerate or reduce dependence after schema/API changes

### Verification

- [x] frontend sends chat requests only to Cognos endpoints
- [x] no production path depends on `/v1/chat/completions`
- [x] chat still renders decrypted history correctly

---

## Phase 7 — Account Key security model on the frontend

### Existing frontend files to rewrite

- [x] `frontend/src/app/services/vault.service.ts`
    - [x] redesign around password + Account Key unlock
    - [x] remove legacy email-salted vault assumptions
    - [x] support trusted-device unlock state
- [x] `frontend/src/app/services/trusted-unlock.service.ts`
    - [x] store a wrapped trusted-device unlock blob in IndexedDB
    - [x] keep the local wrapping key non-extractable via WebCrypto
- [ ] `frontend/src/app/services/crypto.service.ts`
    - [ ] no changes required in the current implementation slice
- [x] `frontend/src/app/services/conversation.service.ts`
    - [x] update any assumptions tied to old vault flow
- [x] auth/register/login UI files
    - [x] add Account Key onboarding and new-device unlock UX
    - [x] add trusted-device unlock behavior

### Backend/schema areas likely involved

- [ ] `backend/internal/auth/repo.go`
    - [ ] support encrypted backup retrieval fields
- [x] add/update migrations for encrypted private-key backup metadata
- [ ] ensure no endpoint accepts plaintext private keys

### Verification

- [x] first device setup generates Account Key
- [x] onboarding requires explicit acknowledgement that losing the Account Key can block recovery
- [x] new device requires password + Account Key
- [x] trusted device can re-open without repeated Account Key prompts
- [x] logout clears local trusted unlock state
- [x] explicit local lock control clears local trusted unlock state

---

## Phase 8 — Legacy path removal

### Backend

- [ ] `backend/pkg/compat/openai/openai.go`
    - [ ] remove once fully replaced
- [ ] `backend/pkg/proxy/*`
    - [ ] remove provider adapters no longer used
- [x] `backend/cmd/api/routes.go`
    - [x] remove legacy `/v1/chat/completions` route

### Frontend

- [x] `frontend/src/app/services/openai.service.provider.ts`
    - [x] delete if no longer used
- [x] remove `openai` SDK usage/imports everywhere

### Verification

- [x] repo-wide search shows no active chat-path dependency on legacy OpenAI compatibility layer

---

## Phase 9 — Documentation and final wording pass

### Docs to update

- [x] `README.md`
    - [x] final wording after implementation lands
- [x] `backend/README.md`
    - [x] remove legacy notes once obsolete
- [x] `docs/security-model.md`
    - [x] update with final implemented details
- [x] `docs/specs/backend-model-selector.md`
    - [x] mark any decisions that changed during implementation

### New docs likely needed

- [ ] backend model catalogue operations doc
- [ ] billing/analytics pipeline doc
- [ ] frontend model-selector data-flow doc
- [ ] crypto/account-key TODO doc if any meaningful security debt remains

### Verification

- [x] no README/doc claims the private key never leaves the device
- [x] docs accurately describe Account Key behavior
- [x] docs match real API paths and model source of truth

---

## Useful repo-wide searches during implementation

- [ ] search legacy model usage
    - `rg -n "hardCodedModels|defaultModel|provider:model|selectedModel\(" backend frontend`
- [ ] search legacy OpenAI transport usage
    - `rg -n "chat\.completions|OpenAI|/v1/chat/completions" backend frontend`
- [ ] search old vault assumptions
    - `rg -n "vault|user_key_pairs|conversation_secret_keys|email.*salt|secret_key" \
      backend frontend`
- [ ] search risky wording
    - `rg -n "private key never leaves|vault password|OpenAI-compatible" README.md \
      backend/README.md docs`

## Final release checklist

- [ ] backend tests pass
- [ ] frontend tests/build pass
- [ ] integration smoke tests pass
- [ ] schema migrations apply cleanly on a fresh DB
- [ ] no plaintext chat content stored at rest
- [ ] no plaintext private key handling remains
- [ ] only approved Infomaniak model(s) are active
- [ ] docs are updated and internally consistent
