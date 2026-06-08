# Backend Model Selector, Sharing-Ready Messages & Gateway Rework — Test Plan

**Related docs:**

- `docs/specs/backend-model-selector.md`
- `docs/specs/backend-model-selector-checklist.md`
- `docs/security-model.md`

This is the branch test plan for the rework.

---

## Goals

- use **red/green TDD** for each implementation slice
- prioritise **integration tests** for backend request flows
- add **unit tests** for security/privacy logic and cost calculation
- add **high-level browser E2E** for user-critical flows
- keep tests focused on behaviour, not styling

---

## Current baseline (recorded before implementation)

### Backend

- `cd backend && go test ./...` ✅ passes

### Frontend

- `cd frontend && pnpm exec ng test --watch=false` ❌ currently fails
    - missing `src/app/guards/keypair-required.guard`
- `cd frontend && pnpm build` ❌ currently fails
    - SCSS budget error in `src/app/pages/chat/chat.component.scss`

These baseline failures were fixed in Phase 1 so new regressions are easier to trust.

## Current status after Phase 1 foundation

### Backend

- `cd backend && go test ./...` ✅ passes
- `/api/v1/models` integration coverage now includes auth, active catalogue response, privacy-tier
  handling, preferred model propagation, and unknown-tier fallback
- completion API tests now exercise the handler through `gateway.MockClient`
- the first legacy proxy → internal gateway bridge is in place for completions
- completion usage payloads now preserve cache-token metadata and provider-reported cost
- billing service unit coverage now includes plan access policy for trial, inactive, PAYG, and
  unlimited states, plus 20% margin application and upper-bound preflight estimates
- billing FX-rate unit coverage now includes fallback/static USD→CHF provider behaviour
- analytics unit coverage now includes usage-event field mapping, privacy exclusions, and emitter
  append behaviour
- completion API tests now cover repo-backed inactive and trial-exhausted billing restrictions
  before any provider call, confirm PAYG state does not block completions, apply custom FX rates,
  emit analytics usage events, record plan-specific usage after successful gateway calls, and use
  the default PocketBase billing repos when no test seam is injected
- PocketBase billing repo coverage now includes legacy `flat_rate` alias mapping, missing-state
  handling, transactional trial balance updates, rollback on duplicate usage event IDs, and
  idempotent trial-state bootstrap
- user-create hook coverage now confirms new users receive trial billing rows automatically and
  that configured trial seed values override the default during bootstrap
- the legacy gateway bridge has unit coverage for request mapping, context propagation, and errors
- prompt assembly logic (`aiagent.BuildMessages`) now has unit coverage for empty input, prompt
  system-message injection, caller-supplied system-message priority, duplicate-system stripping,
  and example placement between the system message and user turn
- the completion handler no longer imports the OpenAI SDK directly; the legacy compat package
  bridges only the legacy `/v1/chat/completions` proxy path
- `/api/v1/models` integration coverage now asserts the response never includes
  `provider_model_id`, `base_url`, or `api_key`, locking the public contract against accidental
  leaks of internal provider routing fields

### Frontend

- `cd frontend && pnpm exec ng test --watch=false` ✅ passes
- `cd frontend && pnpm build` ✅ passes
- `cd e2e && pnpm test` ✅ passes
- `ModelService` coverage now includes login load, eligible-model fallback, no-eligible fallback,
  and logout reset
- `MessageService` coverage now includes structured completion-error message handling for billing,
  rate limits, and generic failures
- `LoginComponent` coverage now includes login-page route links plus submit and post-login redirect
  hot paths
- `RegisterComponent` coverage now includes password-mismatch validation, submit, failure-reset,
  and post-login redirect hot paths
- `AuthService` coverage now includes login error-state transitions, auth-store success-state
  hydration, stale-session logout redirect handling, register create→sign-in chaining, and logout
  cleanup even when the server request fails
- `TrustedUnlockService` coverage now includes local encrypted-blob persistence, wrap-key-backed
  recovery, stale-blob invalidation on vault-session fetch failure, and best-effort logout cleanup
- `UserPreferencesService` coverage now includes encrypted preference hydration, pin deduplication,
  and unpin persistence for conversation pinning
- `CryptoService` coverage now includes constant-time byte comparison, box/secretBox round trips,
  and tampered-ciphertext failure paths
- `VaultService` coverage now includes user key-pair record MAC integrity checks before decryption
- browser E2E now covers high-level authenticated models-loading, send/reply, history-reload,
  unavailable-model guard, trial/inactive billing-restriction flows, and auth route-link
  regression coverage via Playwright

Remaining frontend build warnings are non-blocking style-budget follow-up work.

---

## Canonical commands

### Backend

```bash
cd backend && go test ./...
```

### Guarded real-adapter tests

```bash
cd backend && RUN_INTEGRATION_TESTS=true go test ./... -tags=integration
```

### Frontend unit tests

```bash
cd frontend && pnpm exec ng test --watch=false
```

### Frontend build

```bash
cd frontend && pnpm build
```

### Browser E2E

```bash
cd e2e && pnpm test
```

---

## Test layers

### 1. Backend unit tests

Use for:

- privacy-tier eligibility logic
- billing cost calculation
- gateway contract behaviour with mocks
- crypto wrapping/unwrapping and ciphertext round trips
- analytics serialization / flush threshold logic

### 2. Backend integration tests

Default layer for:

- first-party HTTP routes
- PocketBase-backed persistence
- access control
- ciphertext-only storage guarantees
- billing and analytics side effects

### 3. Guarded adapter tests

Use sparingly for:

- real Infomaniak/Bifrost adapter verification
- real usage/token/provider-cost extraction checks

These must be opt-in and environment-gated.

### 4. Frontend unit/integration tests

Use for:

- model selection state
- message service state transitions
- conversation/thread/expiry state handling
- mapping of complete response payloads
- crypto and access-key plumbing where practical

### 5. Browser E2E

Use for:

- real high-level chat flow
- history reload
- trial/inactive billing restriction flow
- model eligibility flow

Do **not** test CSS classes, spacing, or animation details here.

---

## Red/green sequence by phase

### Phase 1 — Safety rails, catalogue, and gateway contract

#### Phase 1 red

- add/fix backend tests for `/api/v1/models`
- add/fix catalogue unit tests
- add gateway contract unit tests against a mock client
- add first browser E2E skeleton: authenticated user loads models from backend
- get frontend unit/build baseline under control

#### Phase 1 green

- models API remains stable under tests
- gateway interface exists and handlers depend on it
- frontend baseline is green enough to trust future failures

#### Phase 1 exit criteria

- backend catalogue/models tests pass
- frontend unit/build pass
- first browser E2E passes

---

### Phase 2 — Sharing-ready conversations and messages

#### Phase 2 red

Add backend integration tests first for:

1. create conversation with participant access
2. send message → receive reply → both persisted as ciphertext only
3. non-participant cannot read/write conversation
4. `parent_message_id` survives persistence and retrieval
5. `expires_at` survives persistence and retrieval
6. history reload returns decryptable message records

Add frontend/browser tests for:

1. user sends a message and gets a response back
2. reloading the conversation still shows decrypted history
3. thread/expiry behaviour does not regress at a high level

#### Phase 2 green

- conversation/message rewrite satisfies all access, threading, expiry, and ciphertext tests

#### Phase 2 exit criteria

- ciphertext-only persistence verified
- participant-based access verified
- threading verified
- expiry verified
- send/reply browser flow passes

---

### Phase 3 — Billing, analytics, and real gateway adapter

#### Phase 3 red

Add backend tests first for:

1. trial affordability check blocks request before provider call
2. inactive users receive the documented 402 contract before provider call
3. PAYG usage records correct `balance_transactions` and does not block for funds
4. unlimited usage records metadata without deduction
5. provider-reported cost wins when present
6. fallback pricing path works when provider cost is absent
7. analytics payload includes input/output/cache/provider-cost fields when available
8. analytics payload excludes plaintext content, email, and conversation ID

Add browser E2E for:

1. trial/inactive billing restriction blocks send
2. unavailable model cannot be used by the user

Add guarded real-adapter tests for:

1. real completion succeeds against approved provider
2. usage fields are mapped as expected from the adapter

#### Phase 3 green

- billing and analytics flow pass under integration tests
- browser E2E covers the critical failure modes
- real adapter path is optionally verified behind env flags

#### Phase 3 exit criteria

- trial/inactive gate passes
- PAYG/unlimited usage paths pass
- billing-restriction browser E2E passes
- analytics privacy assertions pass

---

## Minimum test matrix

| Area              | Test                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| Catalogue         | eligible/ineligible model visibility by privacy tier                 |
| Gateway           | handler/service code uses internal interface, not provider SDK types |
| Conversations     | only participants can access a conversation                          |
| Messages          | ciphertext only at rest                                              |
| Threading         | `parent_message_id` preserved                                        |
| Expiry            | `expires_at` preserved                                               |
| Billing           | trial/inactive gate blocks before provider call (integration)        |
| Billing           | 20% margin applied to user-facing completion costs                   |
| Billing           | trial preflight uses catalogue upper-bound estimate with margin      |
| Billing           | PAYG/unlimited/trial usage recording follows the billing contract    |
| Usage             | input/output/cache/provider-cost captured when available             |
| Analytics privacy | no plaintext content or direct identifiers                           |
| Frontend models   | backend-driven model loading works                                   |
| Browser E2E       | send message and get response                                        |
| Browser E2E       | history reload still works                                           |
| Browser E2E       | trial/inactive billing restriction blocks send                       |
| Browser E2E       | unavailable model cannot be selected/sent                            |

---

## Browser E2E scenario outlines

### Scenario 1 — Load models

- sign in as a seeded user
- open the chat UI
- verify models are loaded from the backend
- verify at least one approved model is selectable

### Scenario 2 — Send message and receive reply

- sign in as a seeded user with access to a conversation
- send a simple message
- wait for the assistant reply
- verify the user message and reply are rendered
- do not assert on presentation details

### Scenario 3 — History reload

- sign in as a seeded user with an existing conversation and encrypted messages
- refresh or re-open the conversation
- verify prior messages load and render again

### Scenario 4 — Trial / inactive billing restriction

- seed a user in a billing-blocked state covered by the billing contract
- attempt to send a message
- verify sending is blocked with the expected product behaviour

### Scenario 5 — Model eligibility

- sign in as a restricted-tier user
- verify ineligible models are clearly unavailable
- verify user cannot send with an ineligible model

---

## Guardrails

- do not add brittle style assertions to browser E2E
- do not over-mock backend integration tests
- do not require real provider keys for the main happy-path test suite
- do not add tests that only duplicate framework behaviour
- if a bug is found, reproduce it with a failing test before fixing it

---

## Done definition for the branch

The branch is test-ready when all of the following are true:

- backend tests pass
- frontend unit tests pass
- frontend build passes
- browser E2E passes
- guarded real-adapter tests are available for manual/provider verification
- the checklist and this test plan both match the implemented suite
