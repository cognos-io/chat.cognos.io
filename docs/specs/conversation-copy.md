# Conversation Copy — Product & Architecture Spec

**Status:** Draft  
**Scope:** Copy an existing conversation into a new conversation from chat-level menus. This is not
in-message branching/regeneration.

## 0.0 v1 Scope (decided 2026-06-24)

Read this first. The rest of the spec describes the full design; v1 deliberately ships a subset.

**In v1:**

- Standalone conversations only.
- Redaction copy (standalone): fresh duplicate redaction keypair, secret wrapped for the
  copying Account holder only.
- Client signs the duplicate `id + public_key` (reuses the existing creation signing path).
- One synchronous request, one backend transaction, all-or-nothing. A message-count cap bounds the
  request (see §13).

**Fail closed in v1** (Duplicate action is disabled/blocked, with translated copy — never a silent
partial copy):

- Source has **attachments**.
- Source is a **project conversation**.

**Deferred** (tracked, not lost):

- Project conversation duplicate (§7.2) — also blocked by the missing project-content-key wrapping
  for redaction secrets; needs separate research.
- Attachment byte-copy + re-seal (§6.4) and multiple attachments per message.
- Server-side **enforcement** of `public_key_signature`. Today no key-creation endpoint verifies it;
  enforcement must be a cross-cutting change across all of them, not just this endpoint. v1 signs
  but does not enforce.
- Batched/replayed or background-job copy for very large conversations — see §13 escalation path.

## 0. Decision Summary

Use the user-facing label **“Duplicate chat”**.

Why not “Fork chat”: Cognos already uses branching inside a conversation when an Account holder
edits or regenerates a message. “Fork” is technically accurate, but it sounds like developer tooling
and conflicts with the existing branch UI.

Why not only “Copy chat”: “Copy” can sound like clipboard copy. “Duplicate chat” more clearly means
“create a separate chat with the same history”. Internal docs can still call the process
`conversation-copy`.

A duplicated chat is a **new conversation** with:

- all source messages, including every branch/fork in the message tree;
- the same project relation when the source conversation belongs to a project;
- a fresh conversation keypair;
- re-encrypted conversation metadata and message payloads;
- a fresh redaction keypair and re-encrypted PII map when the source uses Redaction;
- no copied public share link;
- no copied standalone participants, except the Account holder who made the duplicate.

## 1. Problem Statement

Account holders sometimes want to preserve a full chat history and continue from a clean copy
without changing or sharing the original. Today Cognos supports branching inside one conversation,
but that is not the same product action:

- in-message branching keeps all versions inside the same conversation;
- duplicating creates a separate conversation record;
- the duplicate can be renamed, deleted, shared, or continued independently.

The important security difference: Cognos conversations are encrypted to a conversation public key.
A duplicate with a fresh keypair cannot reuse the original message ciphertext.

## 2. Goals

- Add a chat-level **Duplicate chat** action in:
    - the sidebar chat menu;
    - the conversation detail/header menu.
- Copy the complete message graph, not just the active branch.
- Preserve parent/child relationships after message IDs change.
- Keep project conversations in the same project.
- Generate a fresh conversation keypair for the duplicate.
- Re-encrypt all copied encrypted payloads for the duplicate.
- Do not copy public share state.
- Do not copy standalone conversation participants.
- Copy Redaction mappings by re-encrypting them under duplicate redaction keys.
- Show clear in-progress UI and discourage closing/reloading while the browser is re-encrypting.
- Translate all user-facing copy in every supported language.
- Avoid logging plaintext message content during the process.

## 3. Non-goals

- Renaming the existing in-message branch feature to fork/copy.
- Server-side decryption of existing messages.
- Copying a public share link.
- Copying authenticated standalone participants to the new conversation.
- Moving a conversation between personal space and a project.
- Copying only the active visible branch in v1.

## 4. Definitions

| Term                        | Meaning                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| **Source conversation**     | The conversation being duplicated.                                                             |
| **Duplicate conversation**  | The new conversation created by the duplicate action.                                          |
| **Message graph**           | All message rows in a conversation, connected by `parent_message`, including sibling branches. |
| **Standalone conversation** | A conversation not attached to a project. Access is via `participants`.                        |
| **Project conversation**    | A conversation with `project` set. Access is inherited from project membership.                |
| **Public share**            | A `conversation_public_shares` row and public URL token.                                       |

## 5. UX Requirements

### 5.1 Entry points

- Sidebar conversation overflow menu includes **Duplicate chat**.
- Conversation detail/header menu includes **Duplicate chat**.
- The action is hidden or disabled when the conversation is still temporary/not persisted.

### 5.2 User feedback

Duplicating can take noticeable time because the browser decrypts and re-encrypts the full encrypted
history before the backend can write it.

- On start: show a blocking, non-content loading state, e.g. “Duplicating chat…”.
- The loading state must explain: “Keep this tab open. Closing or reloading may cancel the
  duplicate.”
- Disable the Duplicate action while a duplicate is already running for the same source
  conversation.
- Install a best-effort `beforeunload` warning while local re-encryption or upload is in progress.
  This is a guardrail only; browsers may ignore custom text.
- On success: navigate to the duplicate conversation and show a toast, e.g. “Chat duplicated”.
- On failure: leave the Account holder on the source Conversation and show a generic error.
- Error copy must not include message content, decrypted titles, or provider output.

### 5.3 Internationalisation

All user-facing text must use the existing Transloco i18n flow and be translated into every
supported language:

- English (`en`)
- German (`de`)
- French (`fr`)
- Spanish (`es`)
- Portuguese (`pt`)
- Italian (`it`)

This includes menu labels, loading text, keep-open warnings, success toasts, error messages, retry
messages, attachment/redaction warnings, and the title suffix string.

Missing translation keys are a release blocker for this feature, even though the app can technically
fall back to English.

### 5.4 Duplicate title

The browser decrypts the source title and encrypts new conversation metadata with the duplicate key.
Recommended title rule:

```txt
{source title} (copy)
```

If the source title is empty or undecryptable, use the normal new-chat fallback.

## 6. Security and Cryptography

### 6.1 Why messages must be re-encrypted

Existing message rows store `data` as:

```txt
base64(SealAnonymous(message_json, source_conversation_public_key))
```

Only the matching source conversation secret key can open that sealed box. A duplicate conversation
must have a new keypair, so old ciphertext cannot be read with the duplicate secret key.

Therefore, the copy flow must:

1. load the source conversation keypair in the browser;
2. decrypt each source message payload in the browser;
3. rewrite conversation-bound fields to point at the duplicate;
4. encrypt the payload to the duplicate conversation public key;
5. send only ciphertext to the backend for persistence.

The backend must never receive plaintext historical messages as part of duplication.

### 6.2 Conversation metadata

Conversation `data` is also encrypted with the conversation keypair. It must be decrypted in the
browser, adjusted as needed (for example title suffix), and encrypted with the duplicate keypair.

### 6.3 Message binding fields

Copied message payloads must not keep source IDs inside encrypted metadata.

For every copied message:

- the browser generates the duplicate message ID before encryption;
- plaintext record `conversation` becomes duplicate conversation ID;
- plaintext record `parent_message` becomes copied parent ID;
- encrypted `conversation_id` becomes duplicate conversation ID;
- encrypted `parent_message_id` becomes copied parent ID, or is omitted for root messages.

Pre-generating duplicate message IDs avoids a chicken-and-egg problem: the encrypted payload must
contain the copied parent ID, but the backend cannot see or rewrite the encrypted payload after it
assigns IDs.

This preserves the existing client-side binding check in `assertMessageBindings`.

### 6.4 Attachments

> **v1: deferred / fail closed.** v1 blocks duplication of any conversation containing attachments.
> The re-seal design below is the target for the follow-up that also adds multiple attachments per
> message. See §0.0.

Generated image attachments have two layers:

- encrypted file bytes stored on the message record;
- an attachment `sealed_key` inside encrypted message data, sealed to the conversation public key.

For a duplicate:

- attachment ciphertext may be copied byte-for-byte;
- the attachment file key must be opened with the source keypair and re-sealed to the duplicate
  public key;
- the re-sealed key is stored inside the duplicated encrypted message payload.

If attachment byte copying is not implemented in the first backend slice, the Duplicate action must
fail closed for conversations containing attachments rather than silently dropping them.

### 6.5 Redaction mappings

Redaction mappings are not inside message rows. Messages contain placeholder tokens such as
`[[PII_EMAIL_ABC123]]`; the token→original map lives in separate encrypted redaction records.

If a source conversation has a redaction key or redaction entries, the duplicate must copy the PII
map so the duplicate can hydrate the same placeholders.

Required rule:

- generate a fresh redaction keypair for the duplicate conversation;
- decrypt the source redaction secret key in the browser;
- decrypt each source redaction entry in the browser;
- keep the same placeholder token values, because copied messages still contain those tokens;
- rewrite conversation-bound fields to the duplicate conversation;
- when an entry's `source_kind` is `message`, rewrite `source_id` to the copied message ID;
- re-encrypt each entry under the duplicate redaction secret key;
- wrap the duplicate redaction secret key for the duplicate's authorised readers:
    - standalone duplicate: wrap for the copying Account holder only;
    - project duplicate: follow the project conversation access model when project sharing supports
    redaction access;
- persist duplicate redaction key material and entries in the same backend transaction as the
  copied conversation.

If a source conversation has redaction entries and the client cannot copy/re-encrypt them, the
Duplicate action must fail closed. Do not silently create a duplicate that loses PII hydration.

### 6.6 Public sharing

Public share state is never copied.

- Do not create a `conversation_public_shares` row for the duplicate.
- Do not reuse source public-share token, share key, or wrapped share secret.
- The duplicate starts private even when the source was publicly shared.

For standalone shared conversations, authenticated participants are not copied either. The duplicate
has only the copying Account holder as Admin.

For project conversations, project membership still controls access because the duplicate remains in
the same project.

## 7. Access Rules

### 7.1 Standalone source conversation

Any active participant who can read/decrypt the standalone source conversation may duplicate it.

The duplicate is standalone and private:

- `creator = current Account holder`;
- one `participants` row for current Account holder with `role = Admin`;
- no other source participants copied;
- `key_version = 1`.

### 7.2 Project source conversation

> **v1: deferred / fail closed.** v1 blocks duplication of project conversations. This is partly
> blocked by the missing project-content-key wrapping for redaction secrets (a project member other
> than the copier would have no way to read the duplicate's PII map). The design below is the target
> for the follow-up. See §0.0.

If the source conversation has `project` set, the duplicate must be created in the same project.

Required permission:

- caller must be an active project member;
- caller must have a project role allowed to create conversations (`Editor` or `Admin` in the
  current project model).

The duplicate:

- has the same `project` relation;
- has no conversation participant rows;
- stores the duplicate conversation secret key in `project_conversation_keys`, wrapped by the
  current project content key;
- is visible to project members according to normal project access rules.

A project `Viewer` receives `403` because duplicating creates project content.

## 8. API Shape

Recommended endpoint:

```txt
POST /api/v1/conversations/{sourceConversationID}/copies
```

This treats copies as a sub-resource of the source conversation and avoids a verb path like
`/copy`.

### 8.1 Request shape

The browser generates a new conversation ID and one new ID per copied message before the request.
That lets it sign the duplicate public key against the final conversation ID and encrypt message
payloads with final copied parent IDs.

The `id` columns are plain text fields, so IDs do not have to follow PocketBase's default ID format.
v1 uses 15-character lowercase nanoid values. The client must deduplicate within a bundle (a `Set`)
so it never self-collides; cross-record collisions with existing rows remain handled by the `409`
path below.

The duplicate `public_key_signature` is generated (signing `id + public_key`) in v1, but the backend
does **not** yet verify it — signature enforcement is a deferred cross-cutting change (see §0.0). Do
not write client or server code that assumes the signature is currently enforced.

```json
{
  "conversation": {
    "id": "client_generated_id",
    "data": "base64 encrypted duplicate conversation data",
    "public_key": "base64 duplicate public key",
    "public_key_signature": "base64 signature over duplicate id + public key",
    "wrapped_secret_key": "base64 duplicate secret key wrapped for current Account holder",
    "expiry_duration": "optional"
  },
  "project_conversation_key": {
    "wrapped_conversation_secret_key": "base64 secret key wrapped by project content key"
  },
  "messages": [
    {
      "id": "client_generated_duplicate_msg_1",
      "source_id": "source_msg_1",
      "source_parent_id": "source_parent_or_empty",
      "data": "base64 encrypted duplicate message data",
      "expires": "optional existing expiry timestamp"
    }
  ],
  "redaction": {
    "public_key": "optional base64 duplicate redaction public key",
    "wrapped_secret_key": "optional base64 duplicate redaction secret key",
    "entries": [
      {
        "token": "[[PII_EMAIL_ABC123]]",
        "data": "base64 encrypted duplicate redaction entry data",
        "source_kind": "message",
        "source_id": "client_generated_duplicate_msg_1"
      }
    ]
  }
}
```

Rules:

- standalone duplicates require `wrapped_secret_key`;
- project duplicates require `project_conversation_key.wrapped_conversation_secret_key`;
- message `id` values are the final duplicate message IDs;
- message `source_id` values are used only to validate and build the source→duplicate ID map;
- message `data` must already be encrypted to the duplicate conversation public key and must contain
  the final duplicate conversation/message bindings;
- redaction entry `source_id` values must point at duplicate source records, not original source
  records;
- request bodies must not contain plaintext titles, messages, reasoning, redaction originals, or
  attachment plaintext.

### 8.2 Response shape

```json
{
  "conversation": {
    "id": "duplicate_conversation_id",
    "created": "2026-06-24T00:00:00Z",
    "updated": "2026-06-24T00:00:00Z",
    "data": "base64 encrypted duplicate conversation data",
    "key_version": 1,
    "last_activity_at": "2026-06-24T00:00:00Z"
  },
  "message_count": 42
}
```

For project conversations, return the same project conversation shape used by
`GET /api/v1/projects/{projectID}/conversations`, including the project-wrapped key if the frontend
needs it immediately.

### 8.3 Status codes

- `201 Created` — duplicate created.
- `400 Bad Request` — malformed ID, missing key material, invalid message graph.
- `401 Unauthorized` — unauthenticated.
- `403 Forbidden` — caller can read a project conversation but cannot create in that project.
- `404 Not Found` — source conversation does not exist or caller has no read access.
- `409 Conflict` — requested duplicate conversation ID or duplicate message ID already exists.

### 8.4 Client-generated ID conflicts

Client-generated IDs are required because encrypted payloads must contain final conversation and
parent message IDs before the backend can persist them. They can still theoretically conflict with
existing records.

Conflict handling:

1. Backend checks the submitted duplicate conversation ID and every submitted duplicate message ID
   before writing.
2. If any ID already exists, backend returns `409 Conflict` and writes nothing.
3. The browser discards the entire prepared duplicate bundle.
4. The browser generates a new conversation ID, new message IDs, a new conversation public-key
   signature, and fresh encrypted payloads.
5. The browser retries once automatically.
6. If the retry also conflicts or fails, show the generic duplicate failure message.

Do not try to patch only the conflicting ID. Parent IDs and encrypted binding fields are already
embedded in ciphertext, so the safe retry unit is the whole duplicate bundle.

## 9. Backend Write Model

The backend must write the duplicate in one transaction:

1. verify source access;
2. verify project create permission when applicable;
3. validate all submitted IDs are available;
4. validate the submitted message graph against source message IDs;
5. create duplicate conversation;
6. create the duplicate conversation key records;
7. create duplicate redaction key records when supplied;
8. create copied message rows using submitted duplicate IDs and remapped parent IDs;
9. copy attachment ciphertext where present;
10. create duplicate redaction entries when supplied;
11. commit.

Nothing may be persisted if any step fails. This prevents half-state such as:

- a conversation row with no key material;
- key material with only some copied messages;
- copied messages whose parents were not copied;
- a duplicate conversation without the redaction map it needs to hydrate PII placeholders;
- a duplicate of a publicly shared source that accidentally receives a share row.

The transaction does not include the browser's local decrypt/re-encrypt work. If the Account holder
closes or reloads before the request commits, no backend state should exist. If the request reaches
the backend, the backend either commits the complete duplicate or rolls it all back.

## 10. Message Graph Requirements

The duplicate must include every source message row that still exists at copy time.

- Copy root messages.
- Copy every sibling branch.
- Copy deleted/tombstoned messages so branch structure remains stable.
- Preserve parent relationships by remapping source parent IDs to submitted duplicate parent IDs.
- Do not copy messages from any other conversation, even if submitted in the request.

The backend must reject requests where:

- the duplicate conversation ID is malformed or already exists;
- a submitted `source_id` is not in the source conversation;
- a submitted duplicate message `id` is malformed or already exists;
- a submitted parent points outside the submitted source message set;
- the same `source_id` or duplicate `id` appears twice;
- encrypted payload count does not match the source message count, unless a future explicit
  partial-copy mode exists;
- the source message count exceeds the v1 cap (500); the request is rejected with `400` (see §13).

## 11. Data That Is Copied

| Data                          | Copy rule                                                           |
| ----------------------------- | ------------------------------------------------------------------- |
| Conversation encrypted `data` | Re-encrypt to duplicate keypair.                                    |
| Message encrypted `data`      | Re-encrypt every message to duplicate keypair.                      |
| Message tree branches         | Preserve all parent relationships via ID remap.                     |
| Message tombstones            | Copy, to preserve tree shape.                                       |
| Reasoning text                | Copy only inside encrypted message payload.                         |
| Attachments                   | Copy ciphertext and re-seal attachment keys.                        |
| Redaction keypair             | Generate fresh when the source has redaction material.              |
| Redaction mappings            | Copy token map and re-encrypt under duplicate redaction key.        |
| Project relation              | Copy when source is in a project.                                   |
| Expiry duration               | Inherit from source unless product decides otherwise.               |
| Public share link             | Never copy.                                                         |
| Standalone participants       | Never copy; duplicate has only copier as Admin.                     |
| Billing/usage ledger          | Never copy; history remains attached to original generation events. |
| Analytics events              | Emit non-content copy metadata only, if needed.                     |

## 12. Testing Plan

### API e2e tests

Functionality:

- Duplicating a standalone conversation creates a new conversation with only the caller as Admin.
- Duplicating copies all messages, including sibling branches.
- Copied `parent_message` links point to copied message IDs, not source IDs.
- Copied encrypted payloads decrypt with the duplicate keypair and do not decrypt with the source
  keypair.
- Copied encrypted payloads do not decrypt with stale/source conversation keys.
- A source public share does not create a public share for the duplicate.
- A project conversation duplicate is created in the same project.
- Redaction keys and redaction entries are copied with a fresh redaction keypair.
- Copied redaction entries decrypt with the duplicate redaction key and not the source redaction
  key.
- Attachments copy with re-sealed attachment keys when attachments are present.

Permissions:

- A standalone participant can duplicate a readable conversation but does not copy other
  participants.
- A non-participant receives `404` and no gateway/provider call happens.
- A project `Admin` or `Editor` can duplicate a project conversation.
- A project `Viewer` receives `403` and no duplicate rows are written.
- Unauthorised Account holders receive `401`.

Conflict and transaction safety:

- Duplicate conversation ID conflict returns `409` with no rows written.
- Duplicate message ID conflict returns `409` with no rows written.
- Invalid graph submissions are rejected without partial writes.
- Missing key material is rejected without partial writes.
- Missing redaction map copy for a source that has redaction entries is rejected without partial
  writes.
- A forced mid-transaction failure leaves no duplicate conversation, keys, messages, attachments,
  redaction keys, redaction entries, or public-share rows.

Security:

- No plaintext title, message content, reasoning, redaction original, or attachment plaintext is
  stored in PocketBase plaintext columns.
- Public-share records are absent for duplicates of shared sources.
- Collection rules still prevent direct access to copied internals by unauthorised Account holders.

### Browser e2e tests

Functionality:

- Sidebar menu duplicates a chat and navigates to the duplicate.
- Conversation detail/header menu duplicates a chat and navigates to the duplicate.
- The duplicate displays all branches in the branch switcher.
- The duplicate title uses the translated copy suffix.
- A duplicated public chat does not show the “Shared” state.
- Duplicating a project chat keeps it listed under the same project.
- A duplicated redacted chat hydrates PII placeholders using the duplicate redaction key.

Loading and recovery:

- The loading dialog/sheet appears while duplication is in progress.
- The loading UI tells the Account holder to keep the tab open and avoid reload/close.
- Duplicate actions are disabled while the operation is in progress.
- A simulated first `409 Conflict` causes the client to regenerate IDs and retry once.
- A failed duplicate leaves the Account holder on the source Conversation and shows translated
  generic error copy.

I18n:

- All new user-facing strings render in English, German, French, Spanish, Portuguese, and Italian.
- Translation-key coverage is tested so missing duplicate-flow keys fail CI.

### Unit tests

Client crypto and mapping:

- Conversation metadata decrypt → re-encrypt round-trip under a fresh keypair.
- Message payload decrypt → ID rewrite → re-encrypt round-trip.
- Message graph mapper preserves root, child, sibling branch, and tombstone relationships.
- Client-generated ID conflict retry rebuilds the whole encrypted bundle, not just one ID.
- Attachment sealed keys are re-sealed to the duplicate public key.
- Redaction keypair generation creates a fresh keypair for the duplicate.
- Redaction entries keep token values and re-encrypt originals under the duplicate redaction key.
- No plaintext message content is sent in the copy request mapper.

Backend validation:

- Submitted duplicate IDs are validated before writes.
- Duplicate ID conflicts map to `409`.
- Graph validation rejects foreign, missing, duplicate, and cyclic parent data.
- Transaction rollback removes every duplicate artefact on injected errors.

### Logging/security tests

- Backend logs for duplicate failures contain no title, message, reasoning, redaction original, or
  attachment plaintext.
- Analytics, if emitted, include only IDs/counts/timing and no content.

## 13. Decisions & Escalation

Resolved for v1:

- **Expiry semantics:** inherit the source conversation's `expiry_duration` setting. Do not copy
  per-message `expires` timestamps from the source; the duplicate's messages get expiry derived from
  the duplicate conversation's expiry setting, exactly as a fresh conversation would.
- **Large conversations — message-count cap:** v1 copy is synchronous, single-request,
  single-transaction. A hard cap of **500 messages** bounds the request. Sources above the cap fail
  closed with a translated "conversation too large to duplicate" message. The cap is enforced both
  client-side (before doing the work) and server-side (request rejected with `400`).
- **Why not batches/replay:** conflicts are not the scaling concern — with random IDs a `409` is
  astronomically unlikely, so whole-bundle regenerate-on-conflict is effectively dead code and fine.
  The real pressure is payload/transaction size, which the cap handles. Batching across multiple
  transactions would reintroduce the half-state §9 exists to prevent: a partial tree has dangling
  parents (fails `assertMessageBindings`) and redaction entries pointing at messages that never
  landed, and the Account holder cannot tell a truncated duplicate from a complete one. So v1 stays
  atomic.
- **Partial failures for attachments/redaction:** fail closed, never partial.
- **Copy title suffix:** per-locale translated string (see §5.4); not the literal English
  "(copy)" in non-English locales.

Escalation path (deferred): if conversations routinely exceed the cap, do **not** move to
client-driven batches. Move to a **server-side async job**: the client uploads the full ciphertext
bundle once, the server processes it and reports progress, preserving server-side atomicity. This is
out of scope for v1.
