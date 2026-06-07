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

### Frontend

- `cd frontend && pnpm exec ng test --watch=false` ✅ passes
- `cd frontend && pnpm build` ✅ passes
- `cd frontend && pnpm test:e2e` ✅ passes
- `ModelService` coverage now includes login load, eligible-model fallback, no-eligible fallback,
  and logout reset
- browser E2E now covers the first high-level authenticated models-loading flow via Playwright

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
cd frontend && pnpm test:e2e
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
- insufficient balance flow
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

1. PAYG affordability check blocks request before provider call
2. PAYG deduction records correct `balance_transactions`
3. flat-rate usage records metadata without deduction
4. provider-reported cost wins when present
5. fallback pricing path works when provider cost is absent
6. analytics payload includes input/output/cache/provider-cost fields when available
7. analytics payload excludes plaintext content, email, and conversation ID

Add browser E2E for:

1. insufficient balance blocks send for PAYG user
2. unavailable model cannot be used by the user

Add guarded real-adapter tests for:

1. real completion succeeds against approved provider
2. usage fields are mapped as expected from the adapter

#### Phase 3 green

- billing and analytics flow pass under integration tests
- browser E2E covers the critical failure modes
- real adapter path is optionally verified behind env flags

#### Phase 3 exit criteria

- PAYG path passes
- flat-rate path passes
- insufficient-balance browser E2E passes
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
| Billing           | PAYG deducts correctly                                               |
| Billing           | flat-rate records usage without deduction                            |
| Usage             | input/output/cache/provider-cost captured when available             |
| Analytics privacy | no plaintext content or direct identifiers                           |
| Frontend models   | backend-driven model loading works                                   |
| Browser E2E       | send message and get response                                        |
| Browser E2E       | history reload still works                                           |
| Browser E2E       | insufficient balance blocks send                                     |

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
- verify a reply is rendered
- do not assert on presentation details

### Scenario 3 — History reload

- create/send once
- refresh or re-open the conversation
- verify prior messages load and render again

### Scenario 4 — Insufficient balance

- seed a PAYG user with insufficient balance
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
