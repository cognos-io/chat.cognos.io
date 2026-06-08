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
- `config.MustLoadAPIConfig` now has env-loading regression coverage that pins the
  `COGNOS_<SECTION>_<REST>` → `<section>.<rest>` mapping for every provider key plus the billing
  trial seed default
- `/api/v1/billing` integration coverage now exercises the auth gate plus trial/unlimited plan
  payloads and the inactive fallback when no billing row exists
- `/api/v1/billing/transactions` integration coverage now exercises the auth gate, newest-first
  ordering with CHF conversion, trial-row balance projection, and user-scoping so unrelated
  users' ledger rows stay hidden
- `billing.CachedFXRateProvider` now has unit coverage for first-fetch population,
  within-TTL cache hits, post-TTL refresh from the upstream, fallback to the default rate when
  the upstream returns a non-positive value, and tolerance of a nil upstream wrapper
- `analytics.BufferedEmitter` now has unit coverage for size-triggered flush, interval-triggered
  flush against an injectable clock, manual flush, empty-buffer no-op, drain-on-sink-error,
  nil-sink tolerance, and a race-detector concurrent emit/flush stress test; `LoggerSink` has
  coverage that each event is forwarded as a structured JSON payload under the
  `analytics.usage_event` message name
- completion handler helpers now have direct unit coverage: `completionUSDToCHFRate` returns the
  provider rate when present and falls back to 1 when no provider is wired;
  `completeBillingRestrictionResponse` copies plain fields verbatim, converts both
  `balance_rappen` and `estimated_cost_rappen` to CHF, prefers the restriction's estimate over the
  caller-supplied fallback, and leaves the estimate unset when both inputs are zero
- handler input validators now have direct unit coverage: `parsePositiveIntOrDefault` returns the
  fallback for empty, non-numeric, zero, negative, fractional, whitespace-padded, and
  trailing-garbage inputs and passes through valid positive integers;
  `isValidExpiryDuration` accepts the documented allow-list ("", 24h, 168h, 2160h, 4320h) and
  rejects everything else, including superficially-valid time durations, casing/whitespace
  variants, newline injection, and SQL/JS-shaped payloads
- catalogue tests now pin the "only approved Infomaniak models are active" invariant — every
  ActiveModels entry must have provider `infomaniak`, `RequiresNoRetention=true`, and privacy
  tier `ch_only`
- `aiagent.InMemoryAIAgentRepo.LookupPrompt` now has direct unit coverage for the two seeded
  agent IDs (`cognos:simple-assistant`, `cognos:generate-conversation-agent`) and for unknown,
  empty, whitespace-padded, case-shifted, and wrong-namespace IDs all returning
  `ErrAgentNotFound` (exact-match invariant)
- `CryptoService.openSealedBox` now has unit coverage for a successful libsodium-shape round
  trip, rejection with the wrong recipient key pair, rejection of tampered ciphertext bytes,
  and rejection when the ephemeral public-key prefix is swapped (MAC + nonce derivation must
  both fail); `mac` now has additional coverage proving different keys produce different
  output, and both `hash` and `mac` honour the optional `outputLength` parameter
- `crypto.NewNonce` / `NewSymmetricKey` now have unit coverage proving they return the
  documented byte length, never an all-zero value, and a fresh value per call; `AsymmetricEncrypt`
  round-trips through `box.OpenAnonymous`, produces non-deterministic ciphertext for the same
  plaintext (ephemeral key varies), and cannot be opened by a non-recipient key pair;
  `SymmetricEncrypt` round-trips through `secretbox.Open` using the nonce-prefixed layout,
  produces a fresh key + nonce per call, and rejects tampered ciphertext bytes
- `chat.EncryptMessageData` now has unit coverage that the JSON-then-NaCl-box envelope
  round-trips back through `box.OpenAnonymous` into the original `MessageRecordData`,
  produces non-deterministic ciphertext for identical input, honours `omitempty` for every
  optional metadata field (version / conversation_id / parent_message_id / owner_id /
  agent_id / model_id) so empty values never appear in the encrypted payload, and cannot
  be opened by a non-recipient key pair
- `participants` migration (`1760000015_restore_participants_collection.go`) now has
  integration coverage that the collection is restored with the original id
  `52et2jthsxn7mjr` (so existing PocketBase rules referencing `@collection.participants`
  still resolve), exposes the `conversation`/`user`/`role`/`added_at`/`removed_at` fields,
  enforces a unique `(conversation, user)` index, and cascades participant rows when their
  parent conversation is deleted
- `participants.PocketBaseRepo` now has integration coverage that `IsActive` returns false
  for non-participants and empty args, true for an active row, and false once `removed_at`
  is stamped (soft-revoke); `Add` returns `ErrAlreadyParticipant` for duplicate inserts so
  callers can treat re-adding as a no-op
- conversation handler integration coverage now pins the participant-based access path:
  the conversations list returns shared conversations to non-creator participants, message
  listing succeeds for non-creator participants, and creating a conversation auto-seeds an
  Admin participant row for the creator (verified by direct PocketBase lookup)
- completion handler integration coverage now pins that a non-participant POSTing to
  `/api/v1/conversations/{id}/complete` receives 404 with the same body shape as a missing
  conversation, no gateway `Complete` call happens, and no message rows are persisted —
  closing the access leak where any authenticated user could append messages to another
  user's conversation
- the `conversations` / `conversation_public_keys` / `conversation_secret_keys` collections
  all carry a `key_version` column now (default 1, backfilled). Integration coverage pins
  the field exists, `/api/v1/conversations` create/list responses report `key_version` as
  `>=1` (legacy zero/NULL rows surface as 1), the secret-key + public-key create handlers
  stamp the wrapped row with the conversation's current generation (verified by direct
  PocketBase lookup after a simulated prior rotation), and the get handlers default to 1
  for legacy rows so clients never receive an invalid generation
- the secret-key + public-key GET handlers now filter on `key_version = conversation.key_version`,
  with integration coverage pinning that bumping the conversation's generation makes
  pre-rotation wrappers 404 (audit rows stay in the DB but stop round-tripping through
  the API). The PATCH-by-id path on public keys is intentionally exempt — update may need
  to refer to a historical row to attach a signature retroactively.

### Frontend

- `cd frontend && pnpm exec ng test --watch=false` ✅ passes
- `cd frontend && pnpm build` ✅ passes
- `cd e2e && pnpm test` ✅ passes
- `ModelService` coverage now includes login load, eligible-model fallback, no-eligible fallback,
  logout reset, grouped-by-provider derivation, and the unknown-id `selectModel` no-op so a
  stale or attacker-supplied model id can't desync the selector against the catalogue
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
- `parseConversationData` now has unit coverage for whitespace trimming, missing/non-string title
  rejection, malformed JSON rejection, and a zod strip-extras pin so attacker-injected or stale
  fields can never round-trip into ciphertext
- `ignorePocketbase404` now has unit coverage for pass-through emissions, swallowing both
  `ClientResponseError` 404s and plain shape-matching 404 errors, and rethrowing every other
  status (including plain `Error` instances with no status) so real failures stay visible
- `ConversationService.fetchConversationKeyPair` now has unit coverage for the signature-mismatch
  reject path (and that the secret key fetch is skipped) plus the verified happy path that pins
  `openBox` is called with the conversation-shared key derived from the conversation public key +
  user secret key, not from the user key pair alone
- `parseUserPreferencesData` now has unit coverage for default `pinnedModels`, missing/non-array
  `pinnedConversations` rejection, non-string-entry rejection, malformed JSON rejection, and a
  zod strip-extras pin so attacker-injected fields cannot survive a serialise → ciphertext round
  trip
- `AgentService` now has unit coverage that the default `simple-assistant` agent is selected on
  first load, that `selectAgent` ignores ids that are not in the agent list, that `selectedAgent`
  falls back to the default if the selected id no longer resolves, and that `getAgent` returns an
  undefined-signal for missing / empty ids without throwing
- `MessageService.assertMessageBindings` is now an exported pure helper with direct unit coverage:
  no-claim payloads pass through, matching `conversation_id` / `parent_message_id` are accepted,
  mismatched values throw the documented errors, and the asymmetric falsy gate is pinned (empty
  `conversation_id` is ignored, empty `parent_message_id` still participates in the equality
  check so an attacker-claimed missing parent cannot rebind against a real one)
- `MessageService.buildCompletionMessages` is now an exported pure helper with direct unit
  coverage: the assistant message is appended with the response fields mapped onto it,
  `expires` is omitted when the response has no `expiresAt`, present `expiresAt` propagates
  to the parent message, the parent is cloned (never mutated in place) so signal snapshots
  stay stable, no propagation happens when the assistant message has no parent id, and the
  input array reference is returned unchanged
- `MessageService.buildCompletionMessageContext` is now an exported pure helper with direct
  unit coverage: empty input → empty context, empty/null content is skipped, newest-first
  input is flipped to oldest-first output, role is inferred from `owner_id` (user) vs no
  `owner_id` (assistant), the participant name resolves owner_id → agent → model with each
  fallback pinned independently and the missing-on-all-three case staying undefined, the
  ">=" budget check stops _before_ the overflowing message (so we never half-include one),
  and a single first message larger than the whole input budget yields an empty context.
  Bug fix carried in the same refactor: the previous call site read
  `getAgent(id).name` (the Signal function's `Function.prototype.name`) instead of
  `getAgent(id)()?.name` (the resolved agent's name), which always shadowed the model-name
  fallback with a meaningless string — the new helper invokes the resolver correctly.
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
