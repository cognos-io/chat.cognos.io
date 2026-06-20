# Browser PII Redaction

Cognos will offer browser-side sensitive-data redaction for chat messages first, and document/file
content later. The browser detects common sensitive values before a prompt leaves the device,
replaces them with stable placeholders, stores the placeholder-to-original mapping encrypted under a
separate redaction key, and restores the original values only in clients that hold that key.

The feature strengthens Cognos' existing encryption posture: model providers receive redacted
content, the backend persists redacted message content, and public shares default to redacted-only
views.

## 1. Overview

PII redaction is a client-side preprocessing and rendering layer for text sources in a conversation.
It has three jobs:

1. detect high-confidence sensitive values in browser-controlled text,
2. replace those values with model-safe placeholder tokens before any completion request, and
3. hydrate placeholder tokens back to original values only when the active viewer has explicit
   access to the redaction mapping.

Example draft typed by a user:

```txt
Please check IBAN GB82 WEST 1234 5698 7654 32 for this invoice.
```

Text sent to the backend and model provider:

```txt
Please check IBAN [[PII_IBAN_Q7K9M2]] for this invoice.
```

Text rendered to the original user when the redaction key is available:

```txt
Please check IBAN GB82 WEST 1234 5698 7654 32 for this invoice.
```

Text rendered in a redacted-only public share:

```txt
Please check IBAN [[PII_IBAN_Q7K9M2]] for this invoice.
```

## 2. Target audience

Primary users:

- privacy-conscious Cognos chat users who want to ask models about sensitive work or personal data
  without sending raw values to third-party model providers;
- business users handling financial identifiers, customer contact details, or operational secrets in
  prompts;
- users who share conversations and need a safe default that does not disclose sensitive mappings to
  public readers.

Secondary users:

- future document-upload users who want model help over files without sending raw PII from extracted
  document text;
- admins/reviewers evaluating Cognos' data-minimisation story.

## 3. Problem statement

Cognos currently encrypts stored chat history, but completion requests still send plaintext prompt
content to the backend and onward to approved model providers. This is acceptable for the current
security model, but it creates avoidable exposure for structured sensitive values such as IBANs,
email addresses, phone numbers, credit-card-like numbers, and API keys.

Current workaround: users manually replace sensitive values before sending prompts, then mentally
map model responses back to the originals. This is error-prone, slow, and easy to forget.

Cost of not solving it:

- providers see sensitive raw values that are avoidably exposed;
- users avoid using Cognos for useful high-value workflows;
- shared conversations can expose sensitive values unless users manually scrub them;
- future file uploads would multiply exposure unless redaction is part of the source-ingestion
  model.

## 4. Goals

- Redact common high-confidence sensitive values in the browser before completion requests.
- Store message content in redacted form while preserving local usability through client-side
  hydration.
- Store token-to-original mappings encrypted under a separate redaction key, not the conversation
  key.
- Make public sharing redacted-only by default.
- Allow explicit public sharing with sensitive values only when the sharer chooses that mode.
- Design the redaction engine around generic text sources so future document uploads reuse the same
  mechanism.
- Avoid sending raw detected sensitive values to the backend, model providers, logs, analytics, or
  billing events.

## 5. Non-goals

- Perfect PII detection. The MVP targets high-confidence patterns and must avoid aggressive fuzzy
  matching that corrupts normal text.
- Server-side redaction. The backend must not inspect raw prompt content to detect PII.
- Full data-loss-prevention policy management.
- Organisation-level compliance workflows, approvals, or audit exports.
- OCR, file parsing, vector indexing, or file upload implementation in the first chat-only slice.
- Retrofitting historical conversations automatically. Historical migration can be planned
  separately.

## 6. Core features

### 6.1 Browser-side detection and redaction

- **Description**: Detect supported sensitive values in user-entered text and replace them with
  placeholder tokens before completion requests are built.
- **User story**: As a privacy-conscious user, I want Cognos to redact sensitive values before a
  prompt is sent so that model providers receive only placeholders.
- **Priority**: P0
- **Acceptance criteria**:
    - Given a user message containing a supported IBAN, the completion request contains a
      placeholder
    token and does not contain the original IBAN.
    - Given a user message containing a supported email address, the completion request contains a
    placeholder token and does not contain the original email address.
    - Given text with no supported sensitive values, the outgoing text is unchanged.
    - Redaction happens before title generation for a new conversation.
    - Redaction happens before normal send, edited-message fork, and regeneration context calls.

### 6.2 Stable placeholder tokens

- **Description**: Generate model-safe placeholders that are stable within a conversation and safe
  to expose to the backend/provider.
- **User story**: As a user, I want placeholders to remain stable in a conversation so that model
  replies can refer to the same redacted values consistently.
- **Priority**: P0
- **Acceptance criteria**:
    - Tokens use the format `[[PII_<TYPE>_<RANDOM>]]`, for example `[[PII_IBAN_Q7K9M2]]`.
    - The random suffix is generated with browser cryptographic randomness and is not derived from
      the
    original value.
    - The same normalized sensitive value in one conversation maps to one token.
    - The same sensitive value in different conversations does not need to reuse the same token.
    - Tokens never contain the original value, a reversible encoding, or a deterministic hash of the
    original value.

### 6.3 Encrypted redaction mapping

- **Description**: Persist token-to-original mappings as encrypted records under a dedicated
  redaction key.
- **User story**: As a user, I want Cognos to remember redacted values securely so that my own UI
  can restore them without exposing them to public shares by default.
- **Priority**: P0
- **Acceptance criteria**:
    - Original sensitive values are stored only inside encrypted redaction-entry payloads.
    - The redaction-entry payload is encrypted with the conversation's redaction key, not the
    conversation message key.
    - The backend can associate a redaction entry with a conversation and token but cannot read the
    original value.
    - Deleting a conversation cascades deletion of its redaction keys and redaction entries.
    - Unauthorized users cannot list, view, create, update, or delete redaction entries through
    PocketBase collection APIs.

### 6.4 Local hydration for message display

- **Description**: Replace placeholders with original values when rendering messages for a viewer
  who has the redaction key.
- **User story**: As a user, I want to see my original values in the conversation so that redaction
  protects external processing without making the chat unusable.
- **Priority**: P0
- **Acceptance criteria**:
    - User messages render with original values when mappings are available.
    - Assistant messages render with original values when they include known placeholders.
    - Unknown placeholders remain visible as placeholders.
    - Hydration is a display concern; stored message data remains redacted.
    - Soft-deleted messages do not expose hydrated values.

### 6.5 Composer redaction preview

- **Description**: Show users that sensitive values will be redacted without mutating the textarea
  while they type.
- **User story**: As a user, I want to know what Cognos will redact before I send so that I can
  trust the feature and avoid surprise edits to my draft.
- **Priority**: P1
- **Acceptance criteria**:
    - The textarea content is not live-mutated during typing or paste.
    - The composer shows a count of detected sensitive values before send.
    - A preview of the redacted text is available without revealing values to the backend.
    - High-confidence (Tier 1) detections are selected for redaction by default; the user can
    deselect any individual detection to send it raw.
    - Tier 2 (NLP) detections are shown unselected and require explicit opt-in per item.
    - Deselecting a detection sends that value in plaintext to the provider; the preview makes this
    consequence clear.
    - Sending applies the redacted text for the selected detections only, creates required mappings,
    and clears draft-only preview state.

### 6.6 Public sharing modes

- **Description**: Public shares default to redacted-only content, with a separate explicit mode to
  include redaction mappings.
- **User story**: As a sharer, I want redacted-only sharing by default so that I can share useful
  conversations without exposing sensitive values.
- **Priority**: P0
- **Acceptance criteria**:
    - Creating a public share defaults to redacted-only.
    - A redacted-only public share includes the conversation key but not the redaction key.
    - A public share with sensitive values includes enough client-side key material for the reader
      to
    decrypt redaction mappings.
    - Switching between redacted-only and include-sensitive-values modes mints a new share token and
    URL.
    - Revoking a public share makes both redacted-only and include-sensitive-values URLs
      unavailable.

### 6.7 Participant and key rotation integration

- **Description**: Keep redaction-key access aligned with conversation participant access.
- **User story**: As a conversation admin, I want redaction mappings to follow participant access so
  that adding or removing people does not accidentally leak sensitive values.
- **Priority**: P0
- **Acceptance criteria**:
    - Adding a participant wraps the redaction key for that participant when the participant
      receives
    PII access.
    - Removing a participant or rotating the conversation key also rotates the redaction key for
      future
    entries.
    - Current-generation redaction-key reads return only the active generation.
    - Public shares are revoked when key rotation invalidates the share's access assumptions.

### 6.8 Future document-source support

- **Description**: Model redaction entries around generic text sources so documents can reuse the
  same redaction engine.
- **User story**: As a future document-upload user, I want document text to use the same redaction
  protection as chat messages so that file workflows do not create a weaker privacy path.
- **Priority**: P1
- **Acceptance criteria**:
    - Redaction-entry source metadata supports at least `message`, `document`, and `document_chunk`.
    - The core redaction engine accepts plain text and does not depend on Angular components or chat
    message state.
    - File-upload implementation can call the same detection, tokenization, and mapping APIs without
      a
    second redaction system.

## 7. Terminology

### Redaction token

A placeholder string that replaces an original sensitive value.

```txt
[[PII_IBAN_Q7K9M2]]
[[PII_EMAIL_A8F2KD]]
```

Rules:

- starts with `[[PII_` and ends with `]]`;
- contains a detector type and random suffix;
- is safe to send to model providers;
- is stable within a conversation for the same normalized value;
- must be preserved exactly by model prompts and UI hydration.

### Redaction entry

An encrypted mapping from a token to an original value, plus metadata.

Decrypted payload shape:

```json
{
  "version": "1",
  "token": "[[PII_IBAN_Q7K9M2]]",
  "type": "iban",
  "original": "GB82 WEST 1234 5698 7654 32",
  "normalized": "GB82WEST12345698765432",
  "detector": "iban:v1",
  "source": {
    "kind": "message",
    "id": "message-id"
  },
  "created_at": "2026-06-19T12:00:00Z"
}
```

### Redaction key

A per-conversation symmetric key used to encrypt and decrypt redaction-entry payloads. It is
separate from the conversation key used for message and conversation data.

### Hydration

Client-side display replacement of known tokens with original values. Hydration never rewrites
stored message data.

## 8. Detector scope

Detectors run in two tiers (see §8.3):

- **Tier 1 (fast, always-on)**: high-precision regex + checksum detectors for structured values.
  These prefer precision over recall and must not corrupt normal prose. They are `high` confidence.
- **Tier 2 (slow, opt-in)**: lightweight pure-JS NLP entity hints (`compromise`) for names,
  organisations, and places. These are `low`/`medium` confidence, advisory, and off by default.

### 8.1 Tier 1 — structured detectors (always-on)

P0 detectors (first slice):

| Type                         | Detector id  | Detector notes                                                                         | Normalization                                    |
| ---------------------------- | ------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| IBAN                         | `iban:v1`    | mod-97 checksum via `ibantools`; ignore invalid-checksum matches. Covers Swiss IBAN.   | Uppercase, remove spaces.                        |
| Email                        | `email:v1`   | Conservative RFC-like pattern; validate via `isEmail`.                                 | Lowercase domain; preserve original for display. |
| Credit card                  | `cc:v1`      | Require Luhn (`card-validator`); avoid replacing short number groups.                  | Remove spaces and separators.                    |
| API/private keys             | `secret:v1`  | Obvious key prefixes + PEM private-key blocks (gitleaks-derived rules) + entropy gate. | Preserve exact original.                         |
| Swiss AHV number             | `ch-ahv:v1`  | `756.XXXX.XXXX.XX` shape + EAN-13 check digit.                                         | Remove separators.                               |
| UK National Insurance number | `uk-nino:v1` | Format validation; exclude invalid prefixes/suffixes (DWP rules).                      | Uppercase, remove spaces.                        |

P1 detectors (later iteration):

| Type         | Detector id | Detector notes                                                                  | Normalization                          |
| ------------ | ----------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| Phone number | `phone:v1`  | `libphonenumber-js` `findPhoneNumbersInText`; conservative; avoid arbitrary IDs.| Remove punctuation except leading `+`. |

### 8.2 Tier 2 — NLP entity hints (opt-in)

- Backed by `compromise` (MIT, ~250KB, no model download, returns character offsets).
- Detects `PERSON`, `ORG`, `PLACE` as advisory candidates with `low`/`medium` confidence.
- Off by default; the user opts in. Lazy-loaded so the bundle cost is only paid when enabled.
- Tier 2 candidates are always surfaced in the preview as deselectable, never silently redacted,
  because of their higher false-positive rate.
- The detector interface is pluggable so a higher-accuracy ML backend (e.g. GLiNER via WebGPU) can
  be added later without reworking the engine.

### 8.3 Detector rules

- Detectors must return ranges in the original text.
- Each candidate carries a `confidence` (`low` | `medium` | `high`) and a stable `detector` id.
- Overlapping detections resolve by highest confidence, then longest range.
- Tier 1 high-confidence candidates are selected for redaction by default; Tier 2 candidates are
  surfaced but require explicit user selection.
- All detectors share one `Detector` interface; tiers differ only in cost and confidence.

## 9. Architecture

### 9.1 Current completion flow

```txt
browser plaintext
  → backend completion endpoint
  → provider
  → backend encrypts persisted messages
  → browser decrypts stored messages
```

### 9.2 Redacted completion flow

```txt
browser raw draft
  → browser detects sensitive values
  → browser creates or reuses redaction tokens
  → browser encrypts new mapping entries with redaction key
  → browser sends redacted prompt/context only
  → backend/provider see placeholders only
  → backend stores redacted message content
  → browser hydrates placeholders for authorised display
```

### 9.3 Source-agnostic redaction engine

The pure redaction module must not depend on Angular or chat components.

Suggested frontend layout:

```txt
frontend/src/app/redaction/
  redaction-types.ts
  redaction-detectors.ts
  redaction-engine.ts
  redaction-hydration.ts
```

Pure function responsibilities:

```ts
detectSensitiveText(text) -> RedactionCandidate[]
applyRedactions(text, existingEntries) -> RedactionResult
hydrateRedactedText(text, entries) -> string
```

Angular services can wrap those pure functions:

```txt
RedactionService
RedactionKeyService
RedactionEntryService
```

Service responsibilities:

- load and decrypt redaction entries for the active conversation;
- create tokens using browser cryptographic randomness;
- encrypt new redaction-entry payloads;
- expose hydrated content for rendering;
- expose composer preview state;
- avoid logging raw originals or decrypted mapping payloads.

## 10. Data model

### 10.1 Conversation redaction keys

PocketBase collection: `conversation_redaction_keys`

Plaintext fields:

```txt
id
conversation
user
key_version
public_key
wrapped_secret_key
created
updated
```

Field meanings:

- `conversation`: relation to `conversations`, cascade delete enabled;
- `user`: relation to `users`, cascade delete enabled;
- `key_version`: redaction-key generation;
- `public_key`: the redaction keypair's public key for this generation (base64, denormalized per
  row; identical across a generation, safe to expose so clients can seal new entries);
- `wrapped_secret_key`: the redaction secret key wrapped (DH `box`) for this user.

Rules:

- collection API rules are `null`;
- first-party API endpoints authorize via active conversation participants;
- reads return only the current redaction-key generation;
- historical generations are retained for audit but not returned by current-generation reads.

### 10.2 Redaction entries

PocketBase collection: `redaction_entries`

Plaintext fields:

```txt
id
conversation
token
key_version
data
source_kind
source_id
created
updated
```

Field meanings:

- `conversation`: relation to `conversations`, cascade delete enabled;
- `token`: placeholder token, plaintext so clients can request/update mappings by token;
- `key_version`: redaction-key generation used to encrypt `data`;
- `data`: encrypted redaction-entry payload;
- `source_kind`: one of `message`, `document`, `document_chunk`;
- `source_id`: message id, document id, or chunk id when available.

Sensitive values must only appear in `data` after encryption.

Indexes:

```txt
UNIQUE(conversation, token)
INDEX(conversation, key_version)
INDEX(conversation, source_kind, source_id)
```

Rules:

- collection API rules are `null`;
- first-party API endpoints authorize via active conversation participants;
- public endpoints return redaction entries only for include-sensitive-values shares;
- redacted-only public endpoints never return redaction-entry data or wrapped redaction keys.

## 11. Key management

### 11.1 Key separation

The redaction key must be **independent random key material**, separate from the conversation key.

Reason: sharing the conversation key for redacted-only public views must not automatically grant the
ability to decrypt token mappings. The redaction key therefore must **not** be derived from the
conversation key (e.g. `blake2b(conversation_secret || "pii")` is forbidden — a redacted-only public
reader holds the conversation key and could recompute it).

```txt
conversation key → decrypts redacted title/messages
redaction key    → decrypts placeholder-to-original mappings
```

### 11.2 Creation

The redaction key mirrors the existing conversation key model (`crypto.service.ts` +
`conversation_secret_keys`): a fresh Curve25519 keypair per conversation. Redaction entries are
sealed to the redaction **public** key (`createSealedBox`), and the redaction **secret** key is
wrapped per participant via DH `box`, exactly like `conversation_secret_keys`.

When a conversation first needs redaction:

1. Browser generates a fresh redaction keypair (`cryptoService.newKeyPair()`).
2. Browser wraps the redaction secret key for each participant receiving mapping access (DH `box`).
3. Browser stores the redaction public key and per-participant wrapped secret keys through the
   backend (`conversation_redaction_keys`).
4. Browser seals redaction-entry payloads to the redaction public key.

If a conversation never uses redaction, no redaction key is required (lazy creation on first
detected value).

### 11.3 Participant add

When adding a participant:

- if the participant has PII access, the client wraps the current redaction key for them;
- if the participant does not have PII access, they receive only the conversation key and see
  placeholders.

The MVP decision is that normal active participants receive redaction mapping access unless the
product explicitly introduces participant-level PII permissions before implementation.

### 11.4 Rotation

When conversation key rotation occurs because of participant removal or credential refresh:

- rotate the redaction key in the same operation or an immediately coupled operation;
- write new `conversation_redaction_keys` rows for the post-rotation active set;
- stamp future redaction entries with the new `key_version`;
- revoke public shares that were tied to the previous key generation.

### 11.5 Public share keys

A public share can be one of two modes:

| Mode                     | Conversation key                  | Redaction key                     | Result                          |
| ------------------------ | --------------------------------- | --------------------------------- | ------------------------------- |
| Redacted-only            | Included in fragment-derived flow | Not included                      | Reader sees placeholders.       |
| Include sensitive values | Included in fragment-derived flow | Included in fragment-derived flow | Reader sees hydrated originals. |

Switching modes must create a new token and URL.

## 12. API surface

Exact endpoint names can change during implementation, but the API must preserve these behaviours.

Authenticated endpoints:

```txt
GET  /api/v1/conversations/{conversationID}/redaction-key
POST /api/v1/conversations/{conversationID}/redaction-key
POST /api/v1/conversations/{conversationID}/redaction-entries
GET  /api/v1/conversations/{conversationID}/redaction-entries
```

Public-share endpoints need either:

```txt
GET /api/v1/public/conversations/{token}/redaction-entries
```

or redaction-entry fields included in the existing public conversation response only when the share
mode includes sensitive values.

API rules:

- authenticated endpoints require active conversation participation;
- public redaction endpoints require a valid include-sensitive-values share;
- redacted-only shares return no redaction key material and no redaction entries;
- non-participants receive a uniform `404` shape where the existing conversation APIs use that
  pattern;
- handlers must not log request bodies that can contain encrypted mappings or raw message content.

## 13. Completion integration

Critical integration points:

1. normal message send;
2. first-message title generation;
3. edited-message fork;
4. regeneration context;
5. temporary chats;
6. future document prompt context.

The model receives a short non-sensitive instruction when placeholders exist:

```txt
Sensitive values have been replaced with placeholders like [[PII_EMAIL_A8F2KD]].
Preserve these placeholders exactly in your response.
```

This instruction contains no original sensitive values.

Persisted messages:

- user message content stored by the backend is redacted;
- assistant response content stored by the backend is whatever the model returned, ideally including
  placeholders;
- if the assistant response includes known placeholders, the browser hydrates them for authorised
  display.

Temporary chats:

- redaction still applies before provider calls;
- mapping entries can live in memory only unless temporary chats become persistable;
- public sharing does not apply to temporary chats.

## 14. Rendering and export

Rendering rule:

```txt
stored redacted content → hydrate for authorised viewer → render
```

Hydration must be applied consistently to:

- normal message list;
- streaming assistant deltas where safe;
- public conversation page when share mode includes sensitive values;
- export flows when the user explicitly chooses to include sensitive values.

Export modes:

| Export mode              | Output                                               |
| ------------------------ | ---------------------------------------------------- |
| Redacted                 | Stored redacted content with placeholders.           |
| Include sensitive values | Hydrated content plus clear warning before download. |

The default export mode must be redacted.

## 15. Public sharing UX

The share dialog must make the default safe path obvious.

Suggested options:

```txt
(•) Share redacted conversation only — recommended
( ) Include sensitive values — anyone with the link can see restored sensitive data
```

Copy guidance:

- Redacted-only: "Readers can decrypt the conversation, but sensitive values stay as placeholders."
- Include sensitive values: "Anyone with this link can see restored sensitive values. Only use this
  with people allowed to see the originals."

Behaviour:

- Existing redacted-only links are not upgraded in place.
- Existing include-sensitive-values links are not downgraded in place.
- Any mode change revokes the old row and creates a new token.

## 16. Future document upload compatibility

The redaction engine must operate on generic text, not chat-specific objects.

Future document flow:

```txt
browser extracts document text
  → redaction engine detects sensitive values
  → redacted text is chunked/stored/sent
  → mappings are saved as redaction entries
  → source metadata points to document or chunk ids
```

Source metadata examples:

```json
{ "kind": "message", "id": "msg_123" }
{ "kind": "document", "id": "doc_123" }
{ "kind": "document_chunk", "id": "chunk_004" }
```

File-upload implementation must not introduce a second mapping store or a second token format.

## 17. Non-functional requirements

### Performance

- Redaction detection for a 10,000-character message completes in under 50 ms on a mid-range laptop
  browser.
- Composer preview updates are debounced and do not block typing.
- Hydrating 100 visible messages completes in under 100 ms after mappings are loaded.
- Future document redaction processes chunks incrementally so large files do not freeze the UI.

### Security

- Raw detected sensitive values must not be sent to completion endpoints.
- Raw detected sensitive values must not be logged to console, backend logs, analytics, or billing
  events.
- Redaction mappings must be encrypted with a key separate from the conversation key.
- Public redacted-only shares must not receive redaction keys or redaction entries.
- Token generation must use cryptographic randomness.
- Detector tests must include negative cases to avoid corrupting normal numbers and identifiers.

### Scalability

- Redaction entries are scoped by conversation and indexed by `(conversation, token)`.
- Mapping lookup for rendering uses an in-memory token map after decrypting entries.
- Future document chunks reuse the same entries table and source metadata instead of creating a
  separate per-feature mapping system.

### Reliability

- If mapping creation fails, send is blocked with a clear error rather than sending raw content.
- If mapping load fails, messages render with placeholders rather than failing the conversation
  view.
- If hydration fails for one token, other tokens still hydrate.
- If public include-sensitive-values decryption fails, the public page falls back to unavailable or
  redacted placeholders without exposing partial raw data.

## 18. Success metrics

| Metric                                          | Target                                                                         | Measurement method                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Raw PII leakage in completion request tests     | 0 occurrences across supported detector fixtures                               | Frontend unit tests and Playwright network assertions                         |
| Raw PII leakage in persisted backend records    | 0 plaintext occurrences in seeded redaction e2e fixtures                       | API/e2e tests inspecting stored ciphertext and mocked provider request bodies |
| Hydration correctness                           | 100% of known placeholders hydrate in authorised message-render tests          | Vitest component/service tests                                                |
| Redacted-only public share isolation            | 100% of redacted-only public-share tests fail to access mappings               | API e2e tests                                                                 |
| Include-sensitive-values public share hydration | 100% of include-sensitive-values public-share tests hydrate known placeholders | API + browser e2e tests                                                       |
| Composer responsiveness                         | Detection under 50 ms for 10k characters                                       | Frontend unit benchmark-style test or measured performance test               |

## 19. Testing plan

### 19.1 Frontend unit tests

Redaction engine:

- detects valid IBAN and ignores invalid checksum IBAN;
- detects email and preserves original casing in mapping;
- detects credit-card-like values only when Luhn passes;
- detects obvious API keys and PEM private-key blocks;
- resolves overlapping detections deterministically;
- generates non-derived token suffixes;
- reuses existing token for the same normalized value in one conversation;
- leaves unsupported text unchanged.

Hydration:

- replaces known tokens;
- leaves unknown tokens unchanged;
- handles repeated tokens;
- does not hydrate deleted messages;
- does not mutate stored message objects unexpectedly.

### 19.2 Frontend integration/e2e tests

- User types a message with a supported IBAN; the composer shows redaction count.
- Sending the message posts only redacted content to the completion endpoint.
- The rendered user message hydrates to the original for the owner.
- Assistant response containing a token hydrates for the owner.
- New-conversation title generation receives redacted text.
- Editing a message applies redaction to the edited branch.
- Regeneration context uses redacted stored content.

### 19.3 Backend API tests

- Non-participants cannot access redaction keys or entries.
- Active participants can access only current-generation wrapped redaction keys.
- Redaction entries cascade delete with conversation deletion.
- Redacted-only public shares do not expose redaction entries.
- Include-sensitive-values public shares expose only encrypted mapping payloads plus required
  wrapped key material.
- Switching share modes invalidates the old token.

### 19.4 Security regression tests

- Mock provider request body does not contain raw detector fixture values.
- Backend logs in tested error paths do not include raw message arrays.
- Analytics usage events contain model/cost metadata only, not raw prompt content or mappings.
- Public collection rules for new collections are locked down.

## 20. Timeline and milestones

| Phase                                      | Duration   | Deliverables                                                                                     |
| ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------ |
| Phase 1: spec and pure redaction engine    | 1 week     | This spec, detector engine, token model, hydration function, frontend unit tests                 |
| Phase 2: redaction key and mapping storage | 1-2 weeks  | Backend migrations/endpoints, frontend key/entry services, API tests                             |
| Phase 3: chat integration                  | 1-2 weeks  | send/edit/regenerate/title redaction, local hydration, composer preview, browser e2e tests       |
| Phase 4: public sharing modes              | 1 week     | redacted-only default, include-sensitive-values mode, new-token mode switching, public e2e tests |
| Phase 5: document readiness                | 0.5-1 week | source metadata finalisation, document-flow design note, no file-upload implementation           |

## 21. Risks and mitigations

| Risk                                                            | Impact | Likelihood | Mitigation                                                                                                  |
| --------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------- |
| False positives alter useful prompt text                        | Medium | Medium     | Start with high-confidence detectors, show preview, add negative fixture tests.                             |
| False negatives leave sensitive values unredacted               | High   | Medium     | Be explicit that MVP is best-effort, add visible copy, expand detectors iteratively based on safe fixtures. |
| Model rewrites or drops placeholders                            | Medium | Medium     | Use distinctive token format, inject instruction to preserve placeholders, hydrate exact matches only.      |
| Mapping key accidentally shared with redacted-only public links | High   | Low        | Separate redaction key, explicit share modes, e2e tests proving redacted-only cannot decrypt mappings.      |
| Participant removal leaves future mappings decryptable          | High   | Medium     | Couple redaction-key rotation to conversation-key rotation and current-generation read gates.               |
| Large pasted text blocks freeze composer                        | Medium | Medium     | Debounce detection and process future document text in chunks.                                              |
| Raw PII appears in frontend console during debugging            | High   | Medium     | Ban logging of candidates/mappings; test review and lint/code-review checklist for redaction paths.         |

## 22. Decisions (resolved 2026-06-20)

1. **Always-on or user-toggleable** → **Auto-redact with preview + per-item deselect.** Tier 1
   high-confidence detections are selected by default; the user can deselect any item to send it
   raw. Tier 2 NLP detections are opt-in per item. The textarea is never live-mutated.
2. **Phase 2 NLP ambition** → **Lightweight pure-JS (`compromise`), opt-in, lazy-loaded.** Detector
   interface stays pluggable so a heavier ML backend (GLiNER/WebGPU) can be added later. Piiranha is
   excluded (non-commercial licence); Presidio is Python-only and not viable in-browser.
3. **MVP detector list** → IBAN, email, credit-card (Luhn), API/private keys, **Swiss AHV, UK NINo**
   in P0. Phone number is P1.
4. **Participant-level mapping permissions**: active participants can decrypt mappings; no separate
   PII permission tier in this release.
5. **Historical conversations**: no automatic backfill in the first release.
6. **Streaming hydration**: hydrate on render with the same display pipeline, not a special
   streaming mutation path.
7. **First slice scope** → Phases 1–4 (engine, key/mapping storage, chat integration, public sharing
   modes). See §11.4 caveat on rotation.

> ⚠️ **Rotation dependency**: conversation key rotation currently does not re-encrypt historical
> data (`/rotate` is effectively test-only). Coupling redaction-key rotation to it (§11.4) inherits
> that limitation: rotation rewraps keys for the active set going forward but does not re-seal
> historical redaction entries. Full rotation hardening is tracked separately and is out of scope
> for this slice.

## 23. Implementation checklist

- [ ] Add pure redaction types, detectors, engine, and hydration helpers.
- [ ] Add frontend unit tests for positive and negative detector fixtures.
- [ ] Add redaction-key and redaction-entry backend migrations with locked collection rules.
- [ ] Add authenticated redaction-key and redaction-entry endpoints.
- [ ] Add frontend redaction services.
- [ ] Integrate redaction before message send.
- [ ] Integrate redaction before title generation.
- [ ] Integrate redaction with edited-message forks.
- [ ] Integrate redaction with regeneration context.
- [ ] Render hydrated content for authorised viewers.
- [ ] Add composer count and preview UX.
- [ ] Add public sharing mode selection.
- [ ] Ensure redacted-only public shares cannot access mappings.
- [ ] Ensure include-sensitive-values public shares can hydrate mappings.
- [ ] Update `docs/security-model.md` after implementation details are finalised.
- [ ] Add document-upload source metadata notes before file upload implementation begins.
