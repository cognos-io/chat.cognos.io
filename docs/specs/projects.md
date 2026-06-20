# Projects — Encrypted Collaboration Architecture

**Status:** Draft
**Scope:** Architecture plan, not implementation

Projects are shared encrypted workspaces for Cognos. A project can group conversations, shared file
uploads, and shared memory while keeping project content encrypted at rest wherever possible.

The core rule is unchanged from conversations: the server may coordinate access and may process
plaintext transiently during completion requests, but it must not persist plaintext project content.

## Goals

- Let users create encrypted projects with private names, descriptions, conversations, files, and
  memory.
- Let project admins share projects with other Cognos users.
- Let project members decrypt project content client-side.
- Keep project names, file names, file contents, memory contents, and conversation titles encrypted
  at rest.
- Make revocation explicit: removed users lose access to future project content after key rotation.
- Reuse the existing Account Key, user keypair, conversation participant, and key-version patterns
  where possible.

## Non-goals

- Preventing a previously-authorised user from keeping plaintext they already decrypted.
- Server-side semantic search over encrypted files or memory.
- Server-side file previews, thumbnails, virus scanning, or OCR over encrypted uploads.
- Public project sharing.
- Cross-organisation administration.
- Local-first/offline conflict resolution beyond normal encrypted record sync.

## Design summary

Projects should be the collaboration boundary.

Each project has a random symmetric **project content key**. The browser generates this key and
wraps it for each active project participant using that participant's user public key.

```txt
User private key
  ↓ opens
Wrapped project content key
  ↓ opens
Encrypted project metadata
Encrypted project memory
Encrypted file keys
Wrapped project conversation keys
```

Conversations inside a project should still have their own conversation keypair because the backend
currently needs the conversation public key to encrypt persisted AI responses. The project key wraps
conversation secret keys so project membership can grant access without storing one conversation
secret-key wrapper per user per conversation.

```txt
Project content key
  ↓ opens
Conversation secret key
  ↓ opens
Conversation messages and metadata
```

## Cryptographic model

### User keys

Use the existing user keypair and Account Key unlock model. The server stores user public keys and
encrypted private-key backups, but never sees plaintext private keys or Account Keys.

### Project content key

For each project:

- generate a random 32-byte symmetric project content key in the browser
- encrypt project metadata with this key
- wrap this key separately for each participant's public key
- store only ciphertext wrappers on the server

Recommended wrapper:

```txt
wrapped_project_key = sealed_box(project_content_key, participant_public_key)
```

### Project key versions

Projects should have `key_version`, matching the existing conversation key-version pattern.

A project key rotation creates:

- a new project content key
- a new `key_version`
- one wrapped project key for every remaining active participant
- new wrappers for future child resources where required

Old key material may remain for audit/backward compatibility, but read APIs should expose only the
current active generation unless a specific migration path needs old generations.

### Conversation keys inside projects

Project conversations still use conversation public/private keypairs.

For project conversations, store the conversation secret key wrapped by the project content key:

```txt
wrapped_conversation_secret_key = secretbox(conversation_secret_key, project_content_key)
```

The backend stores the conversation public key as it does today, so it can encrypt model responses
before persistence.

## Data model

### `projects`

Plaintext fields:

```txt
id
creator
created
updated
key_version
archived_at optional
```

Encrypted field:

```txt
data
```

Example decrypted `data` payload:

```json
{
  "version": "1",
  "name": "Acme launch",
  "description": "Private project notes",
  "pinned_conversation_ids": [],
  "settings": {
    "memory_enabled": true
  }
}
```

Do not add plaintext fields such as `name`, `description`, `slug`, or `summary`.

### `project_participants`

Plaintext operational metadata:

```txt
id
project
user
role
added_at
removed_at
```

Roles:

```txt
Admin   can invite, revoke, rotate keys, and delete the project
Editor  can create and update project conversations, files, and memory
Viewer  can read/decrypt project content but cannot mutate shared content
```

A user with a non-empty `removed_at` is no longer active.

### `project_key_wrappings`

Stores the project content key encrypted for each participant.

```txt
id
project
user
key_version
wrapped_project_key
created
updated
```

Rules:

- one active wrapper per active participant for the current `key_version`
- wrappers are created client-side
- the server never sees the plaintext project content key

### `conversations`

Add an optional relation:

```txt
project
```

Access rule:

```txt
conversation.project != empty → project membership controls access
conversation.project == empty → existing conversation participant access controls access
```

This avoids maintaining two independent participant systems for project conversations.

### `project_conversation_keys`

Stores conversation secret keys wrapped by the project content key.

```txt
id
project
conversation
conversation_key_version
project_key_version
wrapped_conversation_secret_key
created
updated
```

For a project conversation, the client opens the current project content key, then opens the wrapped
conversation secret key.

### `project_files`

Plaintext fields:

```txt
id
project
uploader
created
updated
size_bytes
key_version
storage_ref
```

Encrypted `data` field:

```json
{
  "version": "1",
  "filename": "roadmap.pdf",
  "mime_type": "application/pdf",
  "description": "Optional user note",
  "conversation_id": "optional",
  "uploaded_at": "2026-06-19T00:00:00Z"
}
```

File bytes must be encrypted before upload.

Recommended file encryption:

```txt
file_key = random 32 bytes
encrypted_file = secretbox_or_chunked_secretbox(file_bytes, file_key)
wrapped_file_key = secretbox(file_key, project_content_key)
```

Do not store plaintext filenames, MIME types, extracted text, previews, or thumbnails unless this is
an explicit product decision.

### `project_memory_items`

Plaintext fields:

```txt
id
project
created_by
updated_by
source_conversation optional
source_message optional
key_version
created
updated
```

Encrypted `data` field:

```json
{
  "version": "1",
  "kind": "fact",
  "content": "The Acme launch target date is 12 August.",
  "confidence": "user_confirmed",
  "created_at": "2026-06-19T00:00:00Z",
  "updated_at": "2026-06-19T00:00:00Z"
}
```

For the first version, memory retrieval should happen client-side:

1. Browser fetches encrypted memory rows.
2. Browser decrypts locally.
3. Browser selects relevant memory.
4. Browser sends selected plaintext snippets in the completion request.

Do not store server-side embeddings for encrypted memory in the first version. Embeddings leak
semantic information.

## API shape

Suggested first-party API routes:

```txt
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/{projectID}
PATCH  /api/v1/projects/{projectID}
DELETE /api/v1/projects/{projectID}

GET    /api/v1/projects/{projectID}/participants
POST   /api/v1/projects/{projectID}/participants
PATCH  /api/v1/projects/{projectID}/participants/{userID}
DELETE /api/v1/projects/{projectID}/participants/{userID}

POST   /api/v1/projects/{projectID}/rotate

GET    /api/v1/projects/{projectID}/conversations
POST   /api/v1/projects/{projectID}/conversations

GET    /api/v1/projects/{projectID}/files
POST   /api/v1/projects/{projectID}/files
GET    /api/v1/projects/{projectID}/files/{fileID}
DELETE /api/v1/projects/{projectID}/files/{fileID}

GET    /api/v1/projects/{projectID}/memory
POST   /api/v1/projects/{projectID}/memory
PATCH  /api/v1/projects/{projectID}/memory/{memoryID}
DELETE /api/v1/projects/{projectID}/memory/{memoryID}
```

Project routes should follow the existing convention for private resources:

- unauthenticated callers get `401`
- non-participants get `404`, not `403`, where returning `403` would reveal the project exists
- role failures for known members may return `403` where the caller already has project access

## Completion flow

Keep the existing conversation completion route:

```txt
POST /api/v1/conversations/{conversationID}/complete
```

For project conversations, the client may include decrypted transient project context:

```json
{
  "messages": [],
  "project_memory": ["Decrypted selected memory item"],
  "file_context": ["Decrypted selected file excerpt"]
}
```

Backend rules:

- accept project memory/file context only for conversations the caller can access
- use the plaintext only for the active model request
- do not persist project memory/file context plaintext
- do not log project memory/file context plaintext
- encrypt any persisted assistant response immediately using the current conversation public key

## Sharing flow

### Create project

1. Browser generates project content key.
2. Browser encrypts project `data`.
3. Browser creates the project.
4. Browser stores a project key wrapper for the creator.
5. Creator receives `Admin` role.

The project and creator participant row should be written transactionally.

### Invite user

1. Admin selects target user.
2. Browser fetches target user's public key.
3. Browser decrypts current project content key locally.
4. Browser creates `wrapped_project_key` for the target user.
5. Backend transaction creates/activates participant row and stores wrapper.

The backend must reject invites that create an active participant without a matching wrapped key.

### Revoke user

Revocation requires key rotation.

1. Admin browser fetches active participants.
2. Admin browser generates a new project content key.
3. Admin browser wraps the new project content key for every remaining active participant.
4. Backend transaction soft-removes revoked users, bumps `project.key_version`, and stores the new
   wrappers.
5. Future project writes use the new key version.
6. Project conversations should rotate before accepting new messages if the revoked user had access
   to the old conversation key.

Important product copy:

```txt
Removing someone prevents them from accessing future encrypted project content. It cannot erase
copies of content they already decrypted.
```

## Write blocking during rotation

To avoid writing new content under a key that is about to be revoked, project writes should be
blocked while rotation is pending.

Possible project fields:

```txt
rotation_pending boolean
rotation_started_at timestamp optional
rotation_started_by user optional
```

Rules:

- only Admins can start or complete rotation
- Editors cannot create files, memory, or project conversations while rotation is pending
- completion requests for project conversations should reject or pause while child conversation key
  rotation is incomplete

This can be simplified for MVP by making rotation a single synchronous API request from the admin
client, but the model should leave room for interrupted rotations.

## File upload privacy tradeoffs

Encrypted uploads protect file contents at rest, but create product limitations:

- the server cannot virus scan plaintext files
- the server cannot generate previews or thumbnails
- the server cannot index file contents
- the server can still see file size, upload timing, uploader, and project membership

If file size leakage matters, add padding later. Do not add padding in the first version unless a
specific threat model requires it.

## Shared memory privacy tradeoffs

Client-side memory keeps memory encrypted at rest, but has limitations:

- relevance search is weaker without server-side embeddings
- selected memory is sent plaintext during completion requests
- the model provider sees selected memory transiently

For the first version, require user-confirmed memory writes. Avoid automatic memory extraction until
there is a clear review UX and a safe deletion/editing flow.

## Plaintext leakage budget

The server may know:

- project IDs
- project membership and roles
- timestamps
- record counts
- file sizes
- uploader IDs
- project/conversation relationships
- billing and usage metadata

The server must not persist:

- project names
- project descriptions
- conversation titles
- message contents
- filenames
- file MIME types if user-supplied/sensitive
- file contents
- file-derived text
- memory contents
- generated project summaries

## Implementation roadmap

### Phase 1 — encrypted projects

- Add project collection and participant collection.
- Add encrypted project metadata.
- Add project list/create/update/delete APIs.
- Add frontend project list/detail shell.

### Phase 2 — project sharing

- Add project key wrappers.
- Add invite flow.
- Add participant list and role management.
- Add revoke + project key rotation.

### Phase 3 — project conversations

- Add optional `project` relation to conversations.
- Add project conversation create/list APIs.
- Add project-wrapped conversation secret keys.
- Ensure project membership gates project conversation access.

### Phase 4 — encrypted files

- Add encrypted file metadata and encrypted byte storage.
- Add upload/download/delete flows.
- Attach files to projects and optionally conversations/messages.

### Phase 5 — shared memory

- Add encrypted project memory records.
- Add client-side memory retrieval and selection.
- Add explicit user-confirmed memory creation/edit/delete.

## Required tests

### Backend/API tests

- Unauthenticated callers cannot access project APIs.
- Non-participants receive `404` for project resources.
- Viewers cannot mutate project content.
- Editors cannot invite, revoke, rotate keys, or delete projects.
- Admin invite writes participant row and key wrapper transactionally.
- Revocation rotates project key and removes future access in one transaction.
- Project conversations inherit access from project membership.
- Non-participants cannot complete against project conversations.
- Collection rules prevent direct PocketBase collection access for project internals.

### Crypto/client tests

- Project metadata encrypt/decrypt round-trips.
- Project key wrappers open only with the intended user's private key.
- Project conversation secret key unwraps with the project content key.
- File metadata and file key wrapping round-trip.
- Memory payload encrypt/decrypt round-trips.
- Wrong key fails closed for projects, files, conversations, and memory.

### E2E tests

- User creates a project and sees decrypted name in the UI.
- Invited user can unlock and view the project.
- Revoked user cannot access content created after revocation.
- Project conversation completion persists only encrypted message records.
- File upload does not send plaintext filename or file bytes to storage APIs.
- Memory item does not appear plaintext in API responses or database records.

### Logging/security tests

- Completion logs do not include message content, project memory, or file context.
- Upload logs do not include filenames or file contents.
- Project APIs never return plaintext `data` fields.

## Decisions (2026-06-20)

- **Scope:** Build the architecture through Phase 3 (encrypted projects → sharing → project
  conversations). Files (Phase 4) and shared memory (Phase 5) are deferred. **Ship Phase 1 first.**
- **Rotation is forward-only**, matching the existing conversation `/rotate`: rotation re-keys and
  re-wraps the project key for remaining members but does **not** re-encrypt existing project
  `data`, file keys, conversation keys, or memory. A revoked member who retained their old wrapped
  key can still decrypt pre-rotation content. This is an accepted limit and must be stated in
  product copy (see "Revoke user"), not just "content they already decrypted".
- **User discovery and billing attribution are deferred** and are explicit gates that must be
  decided _before_ Phase 2 sharing ships (see "Pre-Phase-2 gates" below).

## Gaps found during codebase review (must be built; not in original plan)

- **No user public-key lookup exists.** There is no API or UI to fetch another user's public key by
  email or ID (`backend/cmd/api/routes.go` has only conversation-scoped public-key routes). Every
  sharing flow depends on the admin's browser obtaining the invitee's public key to wrap the project
  key. This primitive — and its enumeration/privacy tradeoff — must be designed before Phase 2.
- **Multi-participant sharing is greenfield on the frontend.** The backend `participants` collection
  and conversation `/rotate` handler exist, but the client only has _public-link_ sharing
  (ephemeral-key sealed box, secret in URL fragment). There is no authenticated multi-participant
  decrypt, invite UI, or role management to reuse. Phase 2 builds this from scratch.
- **File storage backend is undecided.** No upload infrastructure exists; `storage_ref` implies a
  PocketBase-file-field vs S3-compatible decision. Phase 4 is larger than the roadmap implies.
- **Standalone-conversation → project migration flow is unspecified.** Moving an existing
  conversation into a project requires re-wrapping `conversation_secret_key` under the project key
  and reconciling the two participant systems (open decision below).

### Pre-Phase-2 gates (decide before sharing ships)

- **User discovery:** exact-email public-key lookup API (with rate-limiting against enumeration) vs
  invite-by-token (wrap-on-accept). Affects privacy budget.
- **Billing attribution:** acting-user-pays vs project-owner-pays for completions in a shared
  project. No pooled-quota plumbing exists today.

## Validated against the codebase (reusable as-is)

- `participants` collection: `conversation`, `user`, `role` ∈ {Viewer, Editor, Admin}, `added_at`,
  `removed_at` (soft-revoke). `project_participants` mirrors this.
- `conversation_public_keys` / `conversation_secret_keys` with `key_version`; per-participant
  wrapped secret keys; atomic rotation in `backend/internal/handler/conversations.go`.
- 404-not-403 via locked PocketBase collection rules + Go-handler authz (`participants.IsActive`).
- Completion-time response encryption: `sealed_box(data, conversation_public_key)`.
- Conversation `data`/titles are encrypted with `box.before(conv_pk, conv_sk)` (keypair with
  itself), so any member holding `conv_sk` can decrypt the title — the nested-conversation model
  holds.
- All needed primitives (`sealed_box`, `secretbox`, `box`) exist in
  `frontend/.../crypto.service.ts`.

## Open decisions

- Whether project conversations should keep old direct conversation participants for migration, or
  require project membership only once `project` is set.
- Whether project key rotation should be synchronous-only for MVP or support resumable interrupted
  rotations immediately. (Recommend synchronous-only for v1.)
- Whether file MIME type should always be encrypted, or whether a small allowlisted plaintext media
  class is acceptable for UI optimisation. (Recommend always-encrypted for v1.)
- Whether shared memory is user-confirmed only in v1, or whether assistant-suggested memory can be
  added behind an explicit review step. (Recommend user-confirmed only for v1.)
- Whether project deletion should hard-delete child resources immediately or use a soft-delete
  recovery window. (Recommend soft-delete recovery window.)
