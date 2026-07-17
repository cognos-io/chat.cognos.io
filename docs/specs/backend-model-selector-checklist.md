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
- new-device unlock requires the Account Key (after password sign-in)
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
    - [x] rejected login transitions into the error state with Account holder-facing alerting
    - [x] valid auth-store updates populate success state and remembered email
    - [x] stale-session refresh redirects to logout on 401
    - [x] register chains account creation into sign-in with matching password confirm
    - [x] logout clears trusted unlock state even when the server logout request fails
- [x] trusted unlock hot-path unit coverage
    - [x] local encrypted unlock blobs are written only after wrap-key persistence succeeds
    - [x] unlock keys round-trip through local storage plus server-held wrap keys
    - [x] failed wrap-key fetches invalidate stale local blobs
    - [x] logout-style cleanup removes all trusted-unlock blobs even on server delete failure
- [x] Account holder preferences hot-path unit coverage
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
    - [x] authenticated Account holder loads models from backend
    - [x] auth route-link regression re-verified green after the login-page fix

### Verification

- [x] backend unit/integration tests pass for catalogue and models API
- [x] frontend unit tests pass
- [x] first browser E2E passes

---

## Phase 2 — Backend model catalogue and gateway contract

### Backend packages/files

- [x] `backend/internal/catalogue/models.go`
    - [x] keep code-defined catalogue as source of truth
    - [x] only approved Infomaniak model(s) active initially
    - [x] retain eligibility metadata needed by the UI
- [x] `backend/internal/catalogue/models_test.go`
    - [x] expand tier/eligibility coverage if needed
    - [x] pin "active models are approved Infomaniak only" invariant
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
- [x] only approved Infomaniak model(s) are active

---

## Phase 3 — Sharing-ready conversations and messages rewrite

### New backend packages/files

- [ ] `backend/internal/store/conversations.go`
    - [ ] conversation persistence helpers
    - [x] key version support (column landed on `conversations` via 1760000016; surfaced
        on every conversation API response defaulting legacy 0/NULL rows to 1)
- [ ] `backend/internal/store/messages.go`
    - [ ] message persistence helpers for the new schema
- [x] `backend/internal/participants/repo.go` (lives under `participants` rather than `store/`, same
      purpose: single source of truth for "is this Account holder allowed to read this
      Conversation")
    - [x] `IsActive(conversationID, userID)` with `removed_at IS NULL` filter
    - [x] `Add(conversationID, userID, role)` with duplicate-rejection via `ErrAlreadyParticipant`
    - [x] `ListActive(conversationID)` returns Membership rows ordered by added_at for the
        sharing read API (no PocketBase types leak across the package boundary)
    - [x] `ActiveRole(conversationID, userID)` returns the caller's current role, so
        handlers can gate on Admin without leaking PocketBase types
    - [x] `Revoke(conversationID, userID)` stamps removed_at; `ErrParticipantNotFound`
        distinguishes "no active row" from "internal error" at the handler boundary
    - [x] wrapped conversation key access records — the secret-key collection still
        carries the role today, but `key_version` is stamped on every row and the
        rotation endpoint bumps the generation + installs fresh wrappers atomically
        so the contract behaves like a real access-keys table
- [ ] `backend/internal/store/interface.go`
    - [ ] minimal interfaces for handler/service tests
- [x] `backend/internal/handler/conversations.go`
    - [x] create/list conversations by participant access
    - [x] auto-seed an Admin participant for the creator on create
    - [x] list messages preserving thread/expiry metadata (already in place; now also
        gated on participant access via `ownedConversationRecord`)
- [x] `backend/internal/handler/complete.go`
    - [x] validate model ID
    - [x] validate Account holder tier eligibility
    - [x] validate conversation access (participants.Repo gate before any gateway call)
    - [x] persist Account holder + assistant messages with preserved threading/expiry behaviour

### Crypto files

- [ ] `backend/internal/crypto/payload.go`
    - [ ] define final encrypted payload shape
    - [ ] include usage metadata fields as needed
- [ ] `backend/internal/crypto/encrypt.go`
    - [ ] align with conversation-scoped key architecture
    - [x] keep NaCl-based approach
- [x] `backend/internal/crypto/encrypt_test.go`
    - [x] round-trip tests (asymmetric box + symmetric secretbox)
    - [x] invalid-recipient tests (wrong-key rejection)
    - [x] tampered-ciphertext rejection
    - [x] nonce + key length and uniqueness invariants
    - [ ] wrapped conversation-key access tests (deferred to Phase 3 schema work)
- [x] `backend/internal/chat/repo_test.go`
    - [x] `EncryptMessageData` round-trips through `box.OpenAnonymous`
    - [x] ciphertext is non-deterministic for identical input
    - [x] omitempty metadata fields stay out of the encrypted payload
    - [x] wrong-recipient cannot open the encrypted message

### Existing backend files to update

- [x] `backend/internal/auth/repo.go`
    - [x] support Account holder public-key lookup for Participant key wrapping
        (`UserPublicKey(userID)`; `ConversationPublicKey(conversationID)`
        returns the current generation row after rotation)
    - [x] direct repo coverage in `cmd/api/key_pair_repo_test.go`:
        happy-path, ErrNoKeyPair on missing record, invalid-length
        rejection, and the current-generation contract when v1 + v2
        public-key rows coexist
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
    - [x] `participants` (restored under the original id `52et2jthsxn7mjr` so existing
        PocketBase access rules light up unchanged; added `added_at` / `removed_at`
        lifecycle fields; backfilled an Admin row per existing conversation's creator)
    - [x] `conversation_access_keys` key_version contract (still riding on
        `conversation_secret_keys` rather than a dedicated table — the column landed
        via 1760000017 + 1760000018, stamped on create, defaulted on read, ready for
        rotation to filter stale wrappers without dropping audit data)
    - [ ] `messages`
- [ ] ensure server-side rules match first-party API behaviour

### Behaviour that must survive

- [x] threading preserved
    - [x] `parent_message_id` persisted and returned
- [x] expiring-message behaviour preserved
    - [x] `expires_at` persisted and returned
- [x] ciphertext-only persistence preserved
- [x] non-participants cannot read/write the conversation
    - [x] `/api/v1/conversations` list filtered to active participant rows
    - [x] `/api/v1/conversations/{id}/messages` returns 404 to non-participants
    - [x] `/api/v1/conversations/{id}/complete` returns 404 to non-participants (gateway
        Complete is never called for unauthorised attempts)
    - [x] `/api/v1/messages/{id}` PATCH/DELETE gated on participant access

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
    - [x] 22% markup on Account holder-facing cost
    - [x] upper-bound preflight estimate for trial gate
    - [x] plan-aware usage ledger entry builder
    - [x] persistence-backed deduction/record logic
    - [x] provider-cost precedence when available
- [x] `backend/internal/billing/repo.go`
    - [x] PocketBase-backed billing state lookup
    - [x] PocketBase-backed usage ledger writes
    - [x] transactional trial balance update + usage row persistence
    - [x] legacy `flat_rate` → `unlimited` alias on read
    - [x] idempotent trial-state bootstrap for Account holders missing billing rows
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
    - [x] exclude plaintext content and direct Account holder identifiers
- [x] `backend/internal/analytics/emitter.go`
    - [x] emitter seam / recording emitter
    - [x] buffered event writing
    - [x] flush strategy
    - [x] structured-log sink default for production wiring
- [x] `backend/internal/analytics/emitter_test.go`
    - [x] basic append coverage
    - [x] serialization/flush tests
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
    - [x] allow PAYG Account holders through the preflight access policy
    - [x] add preflight affordability check for trial / inactive contract
    - [x] record usage via ledger repo seam after successful completions
    - [x] emit analytics via emitter seam after successful completions
- [ ] `backend/cmd/api/main.go`
    - [x] wire billing/emitter services
    - [x] default to PocketBase billing repos when test seams are not provided
    - [x] auto-provision trial billing state for newly created Account holders
    - [x] default to BufferedEmitter + LoggerSink when no UsageEmitter seam is provided

### Manual-operations note

- [ ] operator/admin path exists to:
    - [ ] set/change plan type manually
    - [ ] inspect billing transactions manually
    - [ ] grant or adjust trial credit manually

### Verification

- [x] trial/inactive affordability gate test passes
- [x] PAYG/unlimited/trial usage recording path passes without blocking completions
- [x] analytics payload excludes plaintext content and direct Account holder identifiers
- [x] input/output/cache/provider-cost fields are recorded as supported by the active provider
- [x] newly created Account holders receive a trial billing state automatically
- [x] configured trial seed is applied during Account holder billing bootstrap

---

## Phase 5 — Frontend model selector and chat integration

### Existing frontend files to update

- [x] `frontend/src/app/interfaces/model.ts`
    - [x] keep only client schema/types, not source-of-truth catalogue data
- [x] `frontend/src/app/services/model.service.ts`
    - [x] fetch models from backend
    - [x] hold selected model
    - [x] support eligibility metadata
- [x] `frontend/src/app/components/chat/message-form/model-selector/model-selector.component.ts`
    - [x] render backend-provided model data
    - [x] show unavailable models clearly
- [x] `frontend/src/app/components/chat/message-list-item/message-list-item.component.ts`
    - [x] resolve assistant model labels from fetched model data
- [x] `frontend/src/app/services/message.service.ts`
    - [x] aligned with the final complete response schema: every
        `assistantMessage` and `usage` field is consumed by
        `buildCompletionMessages` and exercised by unit tests
    - [x] thread and expiry behaviour pinned by
        `buildCompletionMessages` parent-clone tests
- [x] `frontend/src/app/services/cognos-api.service.ts`
    - [x] `mapCompleteRequest` / `mapCompleteResponse` extracted as
        exported pure helpers with direct unit coverage —
        snake_case ↔ camelCase mapping cannot silently drift on a
        backend rename (`cognos-api.service.spec.ts`)
- [x] `frontend/src/app/services/conversation.service.ts`
    - [x] conversation access-key handling aligned with current backend
        contract: `fetchConversationKeyPair` derives the shared key from
        `conversation_public_key + user_secret_key` and the GET handlers
        already filter by `key_version`, so the frontend transparently
        receives the current generation without needing to track it
- [x] `frontend/src/app/services/crypto.service.ts`
    - [x] `openSealedBox` decrypts with the receiver's full conversation
        keypair (Conversation-scoped, not Account holder-scoped); covered by
        `crypto.service.spec.ts` libsodium-shape round trip plus
        wrong-recipient / tampered-ciphertext rejection

### Verification

- [x] no hard-coded model list is required for normal operation
- [x] UI shows all active models
- [x] UI distinguishes selectable vs unavailable models
- [x] send/reply flow still renders decrypted history correctly
- [ ] thread/expiry UX still behaves correctly

---

## Phase 6 — Browser E2E coverage

### Required high-level scenarios

- [x] authenticated Account holder loads models from backend
- [x] authenticated Account holder creates or opens a Conversation
- [x] authenticated Account holder sends a message and receives a response
- [x] conversation history reload still works
- [x] trial/inactive billing restriction blocks sending
- [x] unavailable model cannot be selected/sent
- [x] participants + rotation API (`e2e/tests/participants-api.spec.ts`):
    Admin lists/adds/revokes participants and rotates the key against the
    live backend; Editor role gate blocks writes; outsider 404 leaks no id.
- [x] models catalogue API (`e2e/tests/models-api.spec.ts`): auth gate,
    typed shape, no provider-routing leak (`provider_model_id` /
    `base_url` / `api_key`), `preferred_model_id` omit-on-empty contract.
- [x] billing + transactions API (`e2e/tests/billing-api.spec.ts`): auth
    gate on both endpoints, newly-registered Account holders always land on a known
    plan, CHF amounts (no Rappen leaks via field names or values), and
    per-user ledger scoping enforced across two live users.
- [x] conversations + messages CRUD API (`e2e/tests/conversations-api.spec.ts`):
    auth gate, key_version=1 on create, expiry allow-list, per-user list scope,
    non-participant 404 on PATCH/DELETE/messages, PATCH preserves key_version,
    DELETE removes the row, /messages pagination envelope.
- [x] /completions + /conversations/{id}/complete API
    (`e2e/tests/completions-api.spec.ts`): auth gate, full request-shape
    validation, non-persisted happy path drives the mock AI provider end-to-end,
    persisted happy path round-trips through the encryption envelope, and the
    non-Participant gate blocks message injection into another Account holder's Conversation.
- [x] Account holder-state API (`e2e/tests/user-state-api.spec.ts`):
    /user-key-pair, /user-preferences, /vault-session all pinned for auth gate,
    POST/GET round-trip, owner-only PATCH, cross-user reject, and the
    vault-session PUT-as-upsert contract with strict 44-char wrap_key length.
- [x] conversation-keys API (`e2e/tests/conversation-keys-api.spec.ts`):
    /public-key and /secret-key endpoints fully covered for auth gate, round
    trip, key_version stamping, the single-public-key-per-conversation hook,
    PATCH signature attachment by row id, and per-participant access.
- [x] PocketBase collection-route lockdown
    (`cmd/api/collection_rules_participants_test.go`): conversations /
    public_keys / secret_keys / messages / participants all return 403 on
    every operation (list/view/create/update/delete) for every caller,
    including the owner. The participant-based authorisation lives in
    /api/v1/*; the collection routes are the no-direct-access wall.

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

- [x] `backend/pkg/compat/openai/*`
    - [x] package removed; `/v1/chat/completions` route was already
        unregistered and `TestLegacyChatCompletionsRouteNotFound`
        pins the 404 contract
- [ ] `backend/pkg/proxy/*`
    - [ ] still used by `gateway.LegacyClient`; remove once the Bifrost
        adapter (or successor) lands behind the gateway interface
- [x] `backend/db/migrations/1711007996_created_models.go`
    - [x] retired in 1760000021 (forward-only delete); catalogue now lives
        entirely in `internal/catalogue` and `TestLegacyModelsCollectionRetired`
        pins the collection stays gone

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
