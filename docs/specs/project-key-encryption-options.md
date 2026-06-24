# Project Keys and Encryption Options

**Status:** Draft / security design deep dive  
**Scope:** Project key hierarchy, sharing, revocation, and encrypted project resources  
**Related specs/docs:**

- `docs/security-model.md`
- `docs/specs/projects.md`
- `docs/business_processes/conversation-create.md`
- `docs/business_processes/conversation-key-rotation.md`
- `docs/business_processes/key-version-read-gate.md`
- `docs/business_processes/participant-add.md`

**Related code:**

- `frontend/src/app/interfaces/project.ts`
- `frontend/src/app/interfaces/project.spec.ts`
- `frontend/src/app/services/project.service.ts`
- `frontend/src/app/services/project-conversation.service.ts`
- `frontend/src/app/services/crypto.service.ts`
- `backend/internal/handler/projects.go`
- `backend/internal/handler/project_conversations.go`
- `backend/db/migrations/1760000040_created_projects_collections.go`
- `backend/db/migrations/1760000041_project_conversations.go`

## 1. Purpose

Projects are expected to become shared workspaces. A project may eventually include multiple users,
project chats, project instructions, files, memory, defaults, and other shared configuration.

This spec deep-dives the key-management options for secure, private projects and recommends a path
that fits the current Cognos architecture:

- stored project content stays encrypted at rest
- users decrypt project content client-side after unlocking their account keypair
- the server coordinates access but does not persist project plaintext
- sharing can grant future users access without revealing project keys to the server
- revocation is honest about its limits: it blocks future access after rotation, but cannot erase
  content a user already decrypted or old keys they already retained

This complements `docs/specs/projects.md`, which defines the project product architecture and tracks
implemented phases. This document focuses on the key hierarchy and the available cryptographic
options.

## 2. Current baseline in the codebase

The current implementation already uses the recommended foundation:

```txt
User Account Key
  ↓ unlocks local/private user keypair
User keypair
  ↓ opens sealed project key wrapper
Project content key
  ↓ opens encrypted project metadata
  ↓ opens project-wrapped conversation secret keys
Project conversation keypair
  ↓ opens conversation title/messages
```

Current implemented mechanics:

- The browser generates a random project content key with `CryptoService.randomKey()`.
- Project metadata is encrypted client-side with `secretBox(data, projectContentKey)`.
- The project content key is sealed to the creator's user public key with
  `createSealedBox(projectContentKey, userPublicKey)`.
- `project_key_wrappings` stores one sealed project content key per `(project, user, key_version)`.
- `projects.data` stores opaque encrypted metadata. The server does not see project name,
  description, icon, colour, or instructions in plaintext.
- Project conversations keep their own conversation keypair because the backend needs the
  conversation public key to encrypt assistant responses before persistence.
- Project conversation secret keys are wrapped by the project content key in
  `project_conversation_keys`, not by per-conversation participant rows.
- Project conversation access is gated by project membership.

This baseline should be kept unless a later requirement justifies a more complex group-key protocol.

## 3. Security goals

### Required

- Project names, descriptions, instructions, file names, file contents, memory items, and project
  conversation titles are encrypted at rest.
- The server never stores plaintext project content keys, conversation secret keys, file keys,
  memory contents, or project metadata.
- A project member can decrypt project content on any unlocked device using their user keypair.
- Adding a participant never creates a membership row without the key material needed to decrypt.
- Removing a participant requires key rotation before future writes continue.
- Non-members receive `404` rather than `403` where a response would reveal project existence.
- All synced key/preference state that is user-specific remains encrypted or wrapped; no plaintext
  model/project preference data should be added as a shortcut.

### Desired

- Project sharing scales to small teams without creating excessive per-resource wrappers.
- Project conversations can reuse the existing chat encryption/completion pipeline.
- Future project files and memory can use the same key hierarchy without redesign.
- Rotation is understandable enough to explain honestly in product copy.

### Non-goals

- Preventing a formerly authorised user from retaining plaintext or old keys they already decrypted.
- Protecting plaintext from the backend during an active AI completion request. The existing
  security model trusts the backend as a transient processor.
- Server-side semantic search over encrypted project content.
- Full MLS/Signal-style group messaging semantics in the first shared-project version.
- Hiding project membership, timestamps, record counts, file sizes, or project-conversation
  relationships from the server.

## 4. Threat model and plaintext leakage budget

### The server may know

- project IDs
- creator IDs
- participant IDs and roles
- timestamps
- key versions
- project-conversation relationships
- file sizes and upload timing, if project files ship
- usage/billing metadata for completions

### The server must not persist

- project names
- project descriptions
- project instructions
- project-level default model/persona names if those are considered project content
- conversation titles
- message contents
- file names
- file MIME types, unless an explicit product decision accepts this leak
- file contents
- extracted file text
- memory contents
- generated summaries
- plaintext project content keys
- plaintext conversation secret keys
- plaintext file keys

### Important limitation

During an AI completion, the client may send decrypted project context to the backend so the backend
can call the selected model provider. That plaintext must be treated as transient request data:

- do not log it
- do not store it outside the encrypted message response flow
- do not send it to analytics or billing events
- encrypt any persisted assistant response immediately using the conversation public key

## 5. Option analysis

### Option A — Per-project symmetric content key, wrapped to each participant

**Summary:** Each project has one random symmetric project content key. The key is sealed to each
participant's user public key. Project metadata and project-level child keys are encrypted under the
project content key.

```txt
project_content_key = random 32 bytes
project.data = secretBox(project_metadata, project_content_key)
wrapped_project_key[user] = sealedBox(project_content_key, user_public_key)
```

**Pros:**

- simple mental model
- already implemented for project metadata
- efficient for small teams: one wrapper per user per project key version
- works with existing `CryptoService` primitives
- project settings, instructions, defaults, files, and memory can share the same root key
- easy for a newly invited user to decrypt all current project metadata after receiving one wrapper

**Cons:**

- any active project member with the content key can decrypt all content protected directly by that
  key version
- revocation requires rotating the project content key and re-wrapping for remaining users
- old content encrypted directly under old project keys remains decryptable by anyone who retained
  the old key
- if used directly for every large resource, a single key compromise exposes too much historical
  content

**Fit for Cognos:** Excellent as the project root key.

### Option B — Per-resource keys, each wrapped to every participant

**Summary:** Every project resource has its own random key. Each resource key is sealed to every
participant's user public key.

```txt
file_key = random 32 bytes
file.data = secretBox(file_metadata, file_key)
wrapped_file_key[user] = sealedBox(file_key, user_public_key)
```

**Pros:**

- strong compartmentalisation
- revocation can stop wrapping new resources for removed users
- resource-level sharing policies become possible
- one compromised resource key does not expose the whole project

**Cons:**

- wrapper explosion: users × resources
- inviting a new user to an existing project requires wrapping every resource key to the invitee
- list/load flows need many extra key rows and failure cases
- more complex sync and transactional guarantees
- too heavy for the current product needs

**Fit for Cognos:** Good for future highly granular permissions, but too complex as the default
project-sharing model.

### Option C — Hybrid: project root key wraps child resource keys

**Summary:** Use a project content key as the root. Child resources can have their own keys, but
those child keys are wrapped by the project content key rather than by every participant.

```txt
project_content_key = random 32 bytes
conversation_secret_key = conversation keypair secret half
wrapped_conversation_secret_key = secretBox(conversation_secret_key, project_content_key)

file_key = random 32 bytes
wrapped_file_key = secretBox(file_key, project_content_key)
```

**Pros:**

- matches the implemented project-conversation model
- avoids per-resource × per-user wrapper explosion
- keeps child resources compartmentalised from each other when they have their own keys
- adding a user requires one project-key wrapper, not a rewrap of every child resource
- project files can use per-file keys without needing per-user file wrappers
- project conversations can keep the existing conversation public-key encryption path

**Cons:**

- any user who can open the project content key can open all child keys for that project key version
- revocation still needs project key rotation for future content
- old child-key wrappers under old project keys remain usable for users who retained old project
  content keys
- more moving parts than Option A alone

**Fit for Cognos:** Best fit. This is the recommended architecture.

### Option D — Standalone conversation model copied directly to projects

**Summary:** Treat each project conversation as a normal shared conversation with its own
participants and per-user conversation secret-key wrappers. Project membership is only a grouping
UI.

**Pros:**

- reuses existing standalone conversation participant/rotation APIs
- conversation-level sharing can differ from project-level sharing
- revocation of one chat does not require project-wide rotation

**Cons:**

- project membership and conversation membership can drift
- adding a user to a project requires wrapping every existing conversation secret key
- project-level files/memory still need a separate encryption model
- project conversations no longer inherit project access cleanly
- product semantics become confusing: is access controlled by project or by each chat?

**Fit for Cognos:** Useful for standalone conversations. Not recommended for project conversations
once a conversation has a `project` relation.

### Option E — Server-side KMS or server-held project keys

**Summary:** Store or derive project keys on the server, possibly using a KMS, and enforce access on
read.

**Pros:**

- easiest sharing and revocation implementation
- enables server-side search, previews, indexing, and automation
- easier recovery if users lose keys

**Cons:**

- violates Cognos' privacy posture
- server/database compromise can expose project content
- Cognos staff or infrastructure with sufficient access could decrypt projects
- inconsistent with the Account Key/user-keypair model

**Fit for Cognos:** Reject for private projects.

### Option F — MLS/Signal-style group key agreement

**Summary:** Use a proper group messaging protocol with epochs and membership changes, such as MLS,
for project key evolution.

**Pros:**

- strong group membership semantics
- designed for multi-device secure groups
- better formal treatment of forward secrecy and post-compromise security

**Cons:**

- significant complexity and implementation risk
- browser/client state management is much harder
- overkill for project metadata, files, and AI workspaces in the current product stage
- still does not erase content a user already decrypted
- would require a broader cryptographic review and likely external libraries

**Fit for Cognos:** Not for MVP. Reconsider only if Cognos becomes a large, real-time, multi-device
collaboration product with stronger group-security requirements.

## 6. Recommendation

Use **Option C: hybrid project root key + child resource keys**, built on the current
implementation.

Recommended hierarchy:

```txt
User Account Key
  ↓ unlocks encrypted user private key backup
User keypair
  ↓ opens wrapped project content key
Project content key, version N
  ├─ decrypts project metadata/settings/instructions/defaults
  ├─ wraps project conversation secret keys
  ├─ wraps per-file keys
  └─ wraps project memory keys or memory payloads

Project conversation keypair
  ├─ public key stored for backend response encryption
  └─ secret key wrapped by project content key

File key
  └─ encrypts one file's bytes and metadata
```

Why this is the right tradeoff:

- It follows the existing code and docs rather than introducing a parallel cryptosystem.
- It gives project membership one clear meaning: project members can access project content.
- It avoids per-resource × per-user wrapper explosion.
- It preserves the existing conversation encryption/completion path.
- It leaves room for per-file and per-memory keys later without changing project sharing.
- It is understandable enough to explain to users when revocation happens.

## 7. Key lifecycle flows

### 7.1 Create project

1. Browser requires unlocked user keypair.
2. Browser generates `project_content_key` with CSPRNG.
3. Browser serialises project metadata.
4. Browser encrypts metadata:

   ```txt
   project.data = secretBox(project_metadata, project_content_key)
   ```

5. Browser seals the project key to the creator:

   ```txt
   wrapped_project_key = sealedBox(project_content_key, creator_public_key)
   ```

6. Backend transaction creates:
   - `projects` row with encrypted `data` and `key_version = 1`
   - `project_participants` row for creator as `Admin`
   - `project_key_wrappings` row for creator at version 1

### 7.2 Load project

1. Backend returns project records where caller is an active project participant.
2. Each response embeds the caller's `wrapped_project_key` for the current project `key_version`.
3. Browser opens the wrapper with the user's unlocked keypair.
4. Browser decrypts project metadata with the project content key.
5. If unwrap/decrypt fails, the client skips that project or shows a generic decrypt failure; it
   does not attempt server-side recovery.

### 7.3 Invite participant

There are two viable invite designs.

#### Invite option 1 — exact user public-key lookup

Admin browser searches an exact email/identifier, receives the target user's public key, and wraps
the project content key immediately.

```txt
wrapped_project_key[target] = sealedBox(project_content_key, target_public_key)
```

Backend transaction creates:

- `project_participants` active row
- `project_key_wrappings` row for the same `(project, target_user, key_version)`

Pros:

- simple
- target can decrypt immediately after accepting/accessing
- no pending-invite key dance

Cons:

- public-key lookup can become a user-enumeration vector
- requires careful exact-match UX, rate limits, and generic responses

#### Invite option 2 — invite-by-token, wrap on accept

Admin creates an invite token without knowing the target public key. The target accepts while logged
in; their browser proves identity and creates/receives a wrapper at accept time.

Pros:

- reduces public user-enumeration pressure
- works better for inviting users who do not yet have accounts
- target's current keypair is guaranteed to exist at accept time

Cons:

- admin cannot make project decryptable until target accepts
- more states: pending, expired, accepted, revoked
- needs careful handling for account-key setup before accepting

Recommendation for v1 sharing:

- Prefer **invite-by-token** for unknown/non-user invites.
- Allow **exact-email public-key lookup** only for existing-user flows if rate-limited, audited, and
  non-enumerating.
- In both cases, the backend must never create active membership without a valid project key
  wrapper.

### 7.4 Create project conversation

1. Browser opens project content key.
2. Browser generates a fresh conversation keypair.
3. Browser encrypts conversation metadata/title with the conversation keypair shared key.
4. Browser wraps the conversation secret key with the project content key:

   ```txt
   wrapped_conversation_secret_key = secretBox(conversation_secret_key, project_content_key)
   ```

5. Backend transaction creates:
   - `conversations` row with `project` relation
   - `conversation_public_keys` row
   - `project_conversation_keys` row

Project conversations must not also maintain standalone `participants` or `conversation_secret_keys`
rows unless a future migration needs a compatibility bridge. Access should remain inherited from the
project.

### 7.5 Add project file

Recommended future file model:

```txt
file_key = random 32 bytes
encrypted_file_bytes = chunkedSecretBox(file_bytes, file_key)
encrypted_file_metadata = secretBox(file_metadata, file_key)
wrapped_file_key = secretBox(file_key, project_content_key)
```

Why a per-file key:

- avoids encrypting large files directly with the project root key
- enables future file-level key rotation/copy/move
- limits blast radius of a leaked file key
- keeps the project content key as a key-encryption key, not a bulk-data key

File metadata should include filename, MIME type, display description, and any extracted text. Treat
all of these as sensitive unless explicitly decided otherwise.

### 7.6 Add project memory

Two acceptable v1 patterns:

1. Encrypt each memory payload directly under the project content key.
2. Give each memory item a memory key wrapped by the project content key.

Recommendation:

- Use direct project-key encryption for small user-confirmed memory items in v1.
- Move to per-memory keys only if memory grows large, needs item-level movement, or needs different
  sharing/retention semantics.

Do not store server-side embeddings for encrypted memory in v1; embeddings leak semantic content.

## 8. Revocation and rotation

### 8.1 Honest revocation model

Revocation means:

```txt
Removed users cannot decrypt future content written under the new project key version.
```

Revocation does **not** mean:

```txt
Removed users lose content they already decrypted.
Removed users lose old project keys they already extracted.
Removed users lose old content encrypted under old keys unless old content is re-encrypted.
```

Product copy must say this plainly.

Recommended copy:

```txt
Removing someone stops access to future encrypted project content after the project key is rotated.
It cannot remove content they already viewed or copied.
```

### 8.2 Forward-only project rotation

Use the same principle as conversation rotation:

1. Admin chooses users to revoke.
2. Admin browser opens current project content key.
3. Admin browser generates a new project content key.
4. Admin browser wraps the new project key for every remaining active participant.
5. Backend transaction:
   - soft-removes revoked participants
   - increments `projects.key_version`
   - stores new `project_key_wrappings` for remaining participants
   - marks rotation complete
6. Future writes use the new project key version.

This is forward-only. It does not re-encrypt historical resource versions, old file keys, old
memory, or old conversation keys. The active project metadata blob is a special case: because it is
the current project state, it should be re-sealed under the new project key as part of rotation.

### 8.3 Rotation and project metadata

Current project metadata (`projects.data`) is one blob. If the project key rotates, the latest
metadata should be re-encrypted under the new project key in the same admin flow where possible.

If this is not done, a newly invited user after rotation may have a new project key but only see
metadata encrypted under an old key. Therefore, project rotation should include a fresh encrypted
`projects.data` blob under the new key.

### 8.4 Rotation and existing project conversations

There are three possible treatments for existing project conversations during project rotation.

#### Conversation rotation option 1 — leave old conversations under old project key

- New project conversations use the new project key.
- Existing conversations remain decryptable only to people who retained the old project key.

Pros: simplest.  
Cons: remaining members may lose convenient access unless they keep old keys; confusing.

Reject for normal rotation.

#### Conversation rotation option 2 — rewrap existing conversation secret keys under new project key

- Conversation keypairs stay the same.
- Each existing `conversation_secret_key` is rewrapped under the new project key.
- Future members can decrypt existing conversations if policy permits.

Pros: efficient; no message re-encryption.  
Cons: revoked users who retained old keys can still decrypt old conversations.

Recommended for v1 project rotation.

#### Conversation rotation option 3 — rotate every conversation keypair and re-encrypt messages

- Every project conversation gets a fresh keypair.
- All messages are decrypted client-side and re-encrypted to the new conversation public key.

Pros: strongest forward boundary for future messages and active keys.  
Cons: expensive, fragile for large histories, requires browser to process all message plaintext,
more failure states, still cannot erase previously decrypted content.

Defer. Use only for explicit high-security rekey/export/migration flows.

## 9. Key authenticity and identity risks

### Risk: wrapping to the wrong public key

If the admin's browser wraps a project key to the wrong public key, the wrong account can decrypt
the project and the intended invitee cannot.

Mitigations:

- user public keys must be fetched from authenticated first-party APIs only
- exact-match lookup responses should identify the target clearly without exposing extra user data
- key records should be stable across email changes because email is not a cryptographic identity
- invite acceptance should show the account identity being granted access
- future high-security mode may display public-key fingerprints for manual verification

### Risk: malicious server substitutes a public key

The current Cognos model trusts the server to coordinate public keys. A malicious server could, in
principle, provide an attacker's public key during invite and cause the admin client to wrap to it.
This is already part of the broader trusted-server boundary for authenticated app delivery and key
lookup.

Possible hardening options:

- key transparency log for user public keys
- public-key fingerprints users can compare out-of-band
- signed user-key records chained from account setup
- WebAuthn/device-backed signing of key changes

Recommendation:

- Do not block v1 sharing on key transparency.
- Document that server-side key substitution is outside the current threat model.
- Add fingerprints/key transparency only if Cognos moves toward stronger end-to-end identity claims.

## 10. Access control invariants

Backend handlers must enforce these independently of encryption:

- unauthenticated → `401`
- non-member → `404` where project existence would otherwise leak
- active Viewer → can read/decrypt returned ciphertext, cannot mutate project content
- active Editor → can create/update normal project content, cannot invite/revoke/rotate/delete
- active Admin → can invite, revoke/rotate, manage roles, and delete/archive

Collection rules should stay locked down for project internals; first-party Go handlers perform
authorisation and shape responses.

Transactional invariants:

- Project create writes project + creator participant + creator wrapper atomically.
- Invite writes participant + wrapper atomically.
- Revoke writes participant removal + key rotation wrappers atomically.
- Project conversation create writes conversation + public key + project-wrapped secret key
  atomically.
- Rotation payloads must exactly match remaining participants; missing, duplicate, or extra wrappers
  fail the whole request.

## 11. Data model implications

Existing collections are appropriate:

```txt
projects
project_participants
project_key_wrappings
project_conversation_keys
```

Recommended additions before sharing/rotation:

```txt
projects.rotation_pending boolean
projects.rotation_started_at timestamp optional
projects.rotation_started_by user optional
project_key_wrappings.created_by user optional
project_key_wrappings.algorithm string default 'nacl_sealed_box_v1'
project_conversation_keys.algorithm string default 'nacl_secretbox_v1'
```

Algorithm/version fields are not strictly required for v1 but make future migrations safer.

For future files:

```txt
project_files
project_file_keys
```

Where `project_file_keys` can start as one row per file containing `wrapped_file_key` encrypted by
the project content key. Do not create per-user file wrappers unless requirements change.

## 12. UX/product requirements for shared project encryption

- Unlock gate: users cannot view decrypted project data until their vault/user keypair is unlocked.
- Invite copy must explain that sharing grants access to encrypted project content.
- Revoke copy must explain the forward-only nature of revocation.
- Rotation failures must be visible and recoverable; do not leave the UI pretending a revoke
  succeeded if key rotation failed.
- Project settings should show member roles without exposing encrypted project content to
  non-members.
- If a member cannot decrypt because a wrapper is missing or stale, show a generic localised error
  such as "This project key is not available on this account" rather than leaking key internals.

## 13. Testing requirements

### API/security tests

- Non-members receive `404` for project, project conversations, wrappers, files, and memory.
- Viewers cannot create project conversations, files, memory, invites, or rotations.
- Editors cannot invite, revoke, rotate, or delete projects.
- Project create is atomic: no project without creator participant and wrapper.
- Invite is atomic: no active participant without wrapper.
- Rotation is atomic: no removed participant without new wrappers for all remaining participants.
- Rotation rejects missing, extra, duplicate, or revoked-user wrappers.
- Project conversation create is atomic: no conversation without public key and project-wrapped
  secret key.
- Direct PocketBase collection access to project internals remains blocked.

### Client/crypto tests

- Project metadata encrypt/decrypt round-trips.
- Wrong user key cannot open `wrapped_project_key`.
- Wrong project key cannot open `projects.data`.
- Project conversation secret key unwraps with project content key.
- Wrong project key cannot unwrap project conversation secret key.
- Project rotation can decrypt new metadata with new key and fails with revoked user's wrapper.
- File key wrapping round-trips when files ship.
- Memory payload encryption round-trips when memory ships.

### Browser e2e tests

- Creator creates project and sees decrypted metadata.
- Invited user accepts and sees decrypted project metadata.
- Revoked user loses access to new project content after rotation.
- Remaining users keep access after rotation.
- Project conversation completion persists encrypted messages only.
- No plaintext project name, instructions, file name, memory content, or message content appears in
  API responses or database-visible payloads.

## 14. Open decisions

1. **Invite primitive:** exact-email public-key lookup, invite-by-token, or both?
2. **Rotation implementation:** synchronous-only for v1, or resumable rotation state from the start?
3. **Existing project conversations on rotation:** rewrap existing conversation secret keys under
   the new project key, or require per-conversation rotation for high-security projects?
4. **Project metadata on rotation:** require the admin client to submit re-encrypted `projects.data`
   in the rotation request, or split metadata into versioned rows?
5. **Key authenticity:** stay with server-trusted public-key lookup for v1, or introduce key
   fingerprints/transparency before broad sharing?
6. **User discovery privacy:** what minimum rate-limiting/auditing is required for public-key lookup
   if exact-email invite is supported?

## 15. Decision summary

Recommended for v1 shared projects:

- Keep the current **hybrid project root key + child resource key** model.
- Use one project content key per project key version.
- Seal the project content key to each active participant's user public key.
- Encrypt project metadata directly under the project content key.
- Wrap project conversation secret keys under the project content key.
- Use per-file keys wrapped by the project content key when files ship.
- Use forward-only rotation and honest product copy for revocation.
- Prefer invite-by-token for unknown users; optionally add exact-email public-key lookup for known
  users with enumeration protections.
- Defer MLS/key-transparency until the product needs stronger group identity guarantees.
