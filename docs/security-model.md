# Cognos Security Model

**Status:** Implemented baseline / source of truth for the current rework state
**Related spec:** `docs/specs/backend-model-selector.md`

## 1. Overview

Cognos is an encrypted AI chat application.

Core properties:

- chat message content is stored on the server as **ciphertext only**
- message decryption happens **client-side**
- the server may process plaintext **in-flight** to call AI providers, but must not persist
  plaintext chat content
- users can access their encrypted data on multiple devices via an **encrypted private-key backup**
  model
- the **account password** is for authentication only (sign-in) and is resettable by email
- decrypting data requires the **Account Key**, a high-entropy secret the server never sees; it is
  both the day-to-day unlock secret and the recovery key

This document describes the intended security model and trust boundaries.

## 2. Trust boundaries

### The client

The browser client is trusted to:

- generate key material
- encrypt and decrypt local key material
- decrypt stored chat ciphertext
- derive unlock keys from user secrets

### The server

The server is trusted to:

- authenticate users
- store encrypted records
- route plaintext prompts to approved AI providers
- encrypt messages before persistence
- store encrypted private-key backup material
- record billing and analytics metadata without plaintext message content

The server must **not**:

- store plaintext message contents at rest
- store plaintext private keys
- log plaintext private keys
- log request message arrays

### AI providers

AI providers are trusted only as transient processors of plaintext prompts/responses for completion
requests.

Approved providers must have:

- explicit approval
- documented data-region information
- confirmed **no data retention**

## 3. What the server can and cannot see

### The server can see

- user account metadata needed for auth and billing
- plaintext prompts and conversation context during active completion requests
- plaintext model responses before they are encrypted for storage
- plaintext messages during a **compaction** completion call (same as any completion — see §15)
- model IDs, token counts, provider metadata, and cost metadata
- encrypted private-key backup ciphertext
- public keys (user, conversation, and the per-conversation / per-project **redaction** public keys)
- routing relations needed to authorise access: which conversation a compaction or redaction entry
  belongs to, which user owns a user-scoped record, which project a project-scoped record belongs to

### The server cannot see at rest

- plaintext stored chat history
- plaintext stored conversation titles
- plaintext stored private keys
- plaintext **conversation compaction summaries** (durable memory, rolling narrative, citations,
  covered message IDs, token estimates) — all inside the encrypted `data` blob (§15)
- plaintext **user-scoped and project-scoped memory** (§16)
- plaintext **redaction mappings** at any scope (conversation, user, project) — the server holds
  only the token string and the sealed original (§14, §16)

## 4. Message security model

### At rest

Messages are stored encrypted using the user's public key.

Stored records may include plaintext operational metadata only where necessary for server behavior,
such as:

- message ordering
- timestamps
- role markers

Sensitive message data belongs inside encrypted payloads.

### In transit inside the application flow

For AI completions, the client sends plaintext message history to the backend over TLS.
The backend sends plaintext provider requests over TLS to the approved AI provider.
After the response is received, persisted message content must be encrypted immediately.

This means Cognos protects **data at rest**, not against a fully trusted server during active
request processing.

## 5. Key management model

Cognos uses a **1Password-inspired Account Key model**, with one deliberate
divergence: the Account Key **alone** decrypts data, so a forgotten password is a
normal recoverable event rather than a lock-out. (1Password proper requires both
the master password _and_ the Secret Key and has no individual recovery; we trade
that marginal second factor for working password reset and a single secret to
safeguard.)

Users have two secrets, each with **one job**:

1. **Account password**
   - user-chosen
   - **authentication only** — it is not an input to any data-encryption key
   - resettable by email; resetting it never affects encrypted data
2. **Account Key**
   - high-entropy generated secret (128-bit), shown once at onboarding
   - the **sole** secret that decrypts the private-key backup, and therefore the
     recovery key / Emergency Kit
   - never sent to or stored by the server, so a stolen database cannot be
     brute-forced regardless of password strength

The user's secret key is wrapped under `Argon2id(Account Key, salt)` —
**not** `Argon2id(password + Account Key, salt)`. The wrap scheme is recorded on
the key-pair record (`unlock_scheme`) so the client derives the key the right way.

### Design goals

- support cross-device access
- avoid storing plaintext private keys on the server
- make the data's confidentiality independent of password strength
- make compromise of the auth database insufficient to decrypt user private keys
- keep authentication (password, resettable) cleanly separate from data
  decryption (Account Key), so password loss is recoverable

## 6. Private-key backup model

The server may store:

- the user's public key
- the user's encrypted private-key backup
- encrypted wrapping material and KDF parameters required for client-side unlock

The server must never store:

- the plaintext private key
- the plaintext Account Key

A new device flow should require:

- successful account authentication
- entry of the Account Key
- client-side derivation and unlock of encrypted private-key material

## 7. Cryptography expectations

Cognos should use well-tested primitives.

### Accepted primitives

- **NaCl box** for public-key encryption
- **NaCl secretbox** for symmetric authenticated encryption
- **Argon2id** for password-based key derivation

### Rejected shortcuts

- `sha256(email + password)` as a vault/unlock key
- email-coupled cryptographic identity
- raw or plaintext private-key storage
- `localStorage` for key material

### Additional rules

- use a **random per-user salt** for Account-Key-based derivation
- email changes must not break cryptographic access (email is not an input to any key)
- changing the password must not touch key material (it is authentication-only); only an Account Key
  change re-wraps the secret key, and even then never re-encrypts historical messages

## 8. Trusted-device behavior

Users should not need to repeatedly enter the Account Key on a device they trust, but the web app
must not pretend browser-local storage alone is a strong trust anchor.

### Persistent unlock — split-key model

Cognos uses a **split-key persistent session** modelled on ProtonMail's PersistedSession. Neither
half is sufficient to recover the unlock key on its own, and the wrap-key half is server-side
revocable. This gives the user a stay-unlocked-across-refresh-and-new-tabs experience without
treating the browser-origin as a strong trust anchor.

**Construction (on successful unlock):**

1. The client derives the unlock key from the Account Key + salt via Argon2id, as elsewhere.
2. The client generates a fresh random 32-byte AES-GCM-class symmetric key — the **wrap key**.
3. The client encrypts the unlock key with the wrap key using NaCl `secretbox` and a fresh random
   nonce. The resulting ciphertext + nonce is stored in `localStorage` under a per-user key
   (`cognos:vault-session:<user-id>`).
4. The wrap key is base64-encoded and stored server-side in `vault_session_wrap_keys`, scoped to the
   authenticated user. The collection is locked down with `null` PB rules; access only goes through
   first-party `PUT/GET/DELETE /api/v1/vault-session` endpoints which require the user's auth token.

**Recovery (on page load / refresh / new tab):**

1. The client reads its `localStorage` ciphertext blob. If absent, falls back to prompting.
2. The client makes an authenticated `GET /api/v1/vault-session`. If the server has no record, falls
   back to prompting.
3. The client decrypts the blob with the returned wrap key. On MAC failure, both halves are
   discarded and the user is prompted.

**Invalidation:**

- Explicit lock and logout both clear the local blob and DELETE the server-side wrap key. After
  logout the wrap key is gone forever; any leftover ciphertext on disk becomes undecryptable.
- The PocketBase `users` collection cascades-deletes the wrap key record on user deletion.
- Auth-token revocation (via `RefreshTokenKey()` on logout) prevents the now-deleted wrap key from
  ever being re-fetched by a stolen session token.

**Threat model rationale:**

- **XSS exfiltrating `localStorage`**: ciphertext only — useless without the server wrap key. The
  attacker must additionally make an authenticated request to `/api/v1/vault-session`, which is
  rate-limitable, logable, and revocable. This is the same property that made us reject the prior
  IndexedDB + non-extractable `CryptoKey` design: there, JS in the page could still call
  `subtle.decrypt` on the live key handle. Here, decryption requires reaching server-controlled
  state.
- **Database / storage compromise**: server holds the wrap key but not the ciphertext, and the
  ciphertext is per-device in client `localStorage`. An attacker with only server-side access has a
  random 32-byte string with no associated blob to apply it to.
- **Combined server + client compromise**: this design does not defend against an attacker who
  compromises both halves. Such an attacker can already read the in-memory unlock key on the live
  client; the persistent session adds no extra exposure.
- **Stolen device with browser open**: a powered-on, unlocked browser session can already decrypt
  locally. The persistent session does not make this worse.

**Idle-TTL on the wrap key (implemented):** the wrap key carries a `last_used_at`
timestamp, touched on every read/write through `/api/v1/vault-session`. A cron
sweep deletes wrap keys idle beyond the TTL (currently **30 days**), so an
abandoned-but-open device loses its server-side unlock half and must re-enter the
Account Key. The TTL is deliberately **longer than the auth-token TTL** (5 days):
a returning user re-authenticates with their password without _also_ re-entering
the Account Key — only genuinely abandoned sessions are revoked. This is the
server-side bound that replaces the removed idle auto-logout (see §10).

**Explicitly out of scope for this iteration:**

- Per-fetch wrap-key rotation (single-use wrap keys). Rotation would harden against an XSS that
  briefly reads a snapshot of `localStorage` + one network call, but introduces multi-tab races and
  is deferred.
- Hardware-backed anchor (WebAuthn PRF). Still the long-term north star for unlock without any
  password reprompt at all, but blocked on broader browser support.

That local cache should be cleared or invalidated when:

- the user explicitly locks the account (clears blob + DELETEs wrap key)
- the user logs out (clears blob + DELETEs wrap key, both client-side and server-side via the
  `/v1/auth/logout` endpoint)
- the browser storage is cleared (orphans the wrap key, which becomes harmless on next logout)
- the stored wrapped blob can no longer be decrypted successfully
- the device is intentionally de-authorized in future account-management flows

The wrap key is **not** a long-lived secret: it is single-use-per-unlock from the server's
perspective (replaced on every new unlock) and revocable on demand.

## 9. Onboarding and recovery expectations

### Onboarding

On first setup, the client should:

- generate the user's keypair
- generate the Account Key
- show the Account Key clearly to the user
- require explicit acknowledgement that they copied it to a safe place and that losing it can block
  account recovery
- encrypt private-key material client-side before upload

### Recovery

If a user loses:

- **password only**: fully recoverable. They reset the password by email, sign back in, and decrypt
  with their Account Key. Encrypted data is unaffected because the password is not part of any
  data-encryption key.
- **Account Key only**: encrypted data is unrecoverable. The Account Key is the sole decryption
  secret; this is the irreducible cost of genuine zero-knowledge encryption.
- **password and Account Key**: encrypted data is unrecoverable.

Losing the Account Key is the one unrecoverable case. Onboarding must therefore make safeguarding
the Account Key (the Emergency Kit) unmistakable. This is an intentional tradeoff in favor of
privacy.

## 10. Password change, email change, logout, lost device

### Password change

Because the password is authentication-only and not an input to any
data-encryption key, changing it is a **pure auth operation**:

- it updates the authentication credential only
- it does **not** re-wrap key material or re-encrypt any messages
- the Account Key continues to decrypt data unchanged

### Email change

The email is authentication-only metadata — it is **not an input to any key
derivation** — so changing it never affects encrypted-data access. Email change
is enabled through PocketBase's **verified request → confirm flow**: a
confirmation link is sent to the _new_ address and the change only takes effect
once the user confirms it with that token plus their current password.

- a direct PATCH of the `email` field (which would skip verification) stays
  blocked server-side (`ForbidUserEmailChanges`); changes must go through the
  verified flow
- no key material is re-wrapped and no messages are re-encrypted
- the Account Key continues to decrypt data unchanged

### Logout / lock

The session stays unlocked on a trusted device until the user **explicitly locks
or logs out** (or the auth token finally lapses after days of disuse). There is
**no idle auto-lock**: because the Account Key is the only unlock factor,
auto-locking on inactivity would force re-entry of a high-entropy key many times
a day for no real gain on the user's own device. A quick-unlock factor
(passkey/PIN) is the prerequisite for reintroducing a short idle lock.

Logging out or explicitly locking the account:

- removes trusted-device unlock state from the current device
- requires unlock again before local decryption resumes

### Lost device

A lost device is primarily a local-device compromise event.
Future account-management features should support device revocation, but the baseline assumption is:

- a trusted unlocked device may expose locally available decrypted material to an attacker with
  device access
- the Account Key still protects fresh-device setup elsewhere

## 11. Logging rules

The following must never be logged:

- plaintext request message arrays
- plaintext message contents from completions
- plaintext private keys
- Account Keys
- decrypted trusted-device blobs

If plaintext private-key material appears in logs, treat it as a security incident.

## 12. Billing and analytics privacy boundaries

Billing and analytics may store:

- model ID
- provider
- privacy tier
- token counts
- cache token counts when available
- calculated or provider-reported cost
- timing/latency metadata
- opaque billing identifiers

Billing and analytics must not store:

- plaintext message content
- conversation content
- email addresses in analytics events
- conversation IDs in analytics events
- private keys

Analytics should use an opaque billing identifier rather than the primary user ID where possible.

## 13. Product wording guidance

Avoid saying:

- **"your private key never leaves your device"**

Prefer wording like:

- **"Your private key is encrypted client-side before backup. Cognos never stores the plaintext
  private key."**
- **"New devices require your password and Account Key to unlock your encrypted key material."**
- **"Trusted devices can stay unlocked locally on this browser until you lock the account, log
  out, or clear browser storage."**

## 14. Browser PII redaction (optional layer)

Cognos detects common high-confidence sensitive values (IBAN, email, credit card, API/private keys,
Swiss AHV, UK NINo) in the browser and replaces them with stable placeholder tokens
(`[[PII_<TYPE>_<RANDOM>]]`) **before** any completion request leaves the device. See
`docs/specs/pii-redaction.md` for the full design.

### 14.1 What this changes about the trust model

- For redacted values, neither the backend nor the model provider ever sees the plaintext — they
  receive only placeholders, and the backend persists the redacted message content.
- Random token suffixes use Web Crypto and are never derived from the original value (no reversible
  encoding, no deterministic hash). Raw detected values and decrypted mappings are never logged,
  sent to analytics, or attached to billing events.
- Detection is best-effort and tuned for high precision (it favours avoiding false positives), so it
  is **not** a guarantee that every sensitive value is caught. Redaction is a data-minimisation
  layer on top of — not a replacement for — the encryption model above.

### 14.2 The redaction key (separate from the conversation key)

Token → original mappings are encrypted under a **per-conversation redaction keypair**
(Curve25519), generated lazily on first use and kept **independent of the conversation key**:

- the **redaction public key** seals each mapping entry (anonymous sealed box), so any holder of the
  public key can add entries but only the secret-key holder can read them;
- the **redaction secret key** is wrapped (sealed) to each participant's **personal** key, so it can
  be recovered only by that user — **not** by someone who merely holds the conversation key.

This separation is the load-bearing property for sharing: handing out the conversation key (which is
how a normal share lets a reader decrypt titles and messages) must **not** also hand out the ability
to un-redact. Deriving the redaction key from the conversation key (e.g. `KDF(conversation_secret)`)
is explicitly forbidden for the same reason.

Server-side storage (`conversation_redaction_keys`, `redaction_entries`) holds only ciphertext,
wrapped keys, and the plaintext token string (so clients can look up a mapping by token). The server
can associate a token with a conversation but cannot read the original value. Both collections have
`null` PocketBase API rules; all access flows through `/api/v1` handlers that authorise by active
conversation participation, and the collection lock-down is pinned by a test.

### 14.3 Securely sharing without leaking values

Public sharing reuses the existing fragment-gated link model (§4): the share link is
`/p/<token>#<fragment>`, where the URL **fragment** carries the only secret that unlocks the payload
and is never transmitted to the server (browsers strip fragments from requests). Two modes:

| Mode                                           | What the link carries                                                                                                                                               | What a reader can do                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Redacted-only** (default)                    | Conversation key only (fragment-gated, as today). No redaction key material is stored on the share, and the public redaction-entries endpoint returns `404` for it. | Read the conversation; sensitive values stay as censorship bars. Un-redaction is impossible — the key simply isn't reachable. |
| **Include sensitive values** (explicit opt-in) | Additionally, the redaction **secret** sealed to the share keypair, whose secret half lives only in the URL fragment.                                               | Recover the redaction key from the fragment and reveal originals.                                                             |

So an include-sensitive link gates the redaction key through the URL fragment in exactly the same
way the conversation key is already gated — the server never holds anything that can un-redact on
its own. Switching a share's mode mints a **new token and URL** (the old link stops resolving), and
revoking a share deletes the row so both URLs `404` immediately.

**Two-stage reveal.** Even on an include-sensitive link, the public reader page starts with every
sensitive value hidden behind a censorship bar. The reader must explicitly choose *Include
potentially sensitive values* before the client fetches and decrypts the mappings — viewing
originals is always a deliberate act, never the default. A redacted-only link never offers the
control, because the key material does not exist in the link.

### 14.4 Limitations

- Detection is best-effort (see §14.1); unrecognised values are not protected.
- Redaction-key rotation is coupled to conversation-key rotation and inherits its current limitation
  — it rewraps keys for the active set going forward but does not re-seal historical entries.
- The redaction secret is currently wrapped for the creating user only; other participants gain
  mapping access when participant-add wrapping lands (until then they see placeholders).

## 15. Conversation compaction (encrypted memory)

Long conversations are kept within a model's context window by **compaction**: older messages on the
active branch are summarised and the summary is reused in place of the raw messages on later sends.
The summary is treated as message-grade content — it is **encrypted at rest and never stored in
plaintext**. See `docs/specs/client-side-compaction.md` for the full design.

### 15.1 Storage and encryption

Compactions live in a dedicated `conversation_compactions` collection. Only routing/timestamps are
plaintext columns (`conversation`, `created`, `updated`); everything else is inside an encrypted
`data` blob:

```txt
data = base64(SealAnonymous(conversation_public_key, json_payload))
```

The payload (sealed, so server-opaque) carries the summary's **durable memory** (facts, decisions,
open threads, a glossary of redaction placeholders and exact names), a **rolling narrative**, the
**citations** mapping aliases to real message IDs, the **covered message IDs**, token estimates,
the model ID, and the prompt version. The server can associate a compaction with a conversation (to
authorise and list it) but **cannot read any of that content**.

The collection has `null` PocketBase API rules; all access flows through `/api/v1` handlers that
authorise by active conversation participation — the same membership check that gates messages.

### 15.2 Trust model during the compaction call

Producing a compaction runs a provider completion over the (aliased) messages, so it has the **same
live-request exposure as any completion (§4)**: the backend and the chosen provider see plaintext
in flight, and the result is encrypted immediately before storage. Two redaction-preserving
properties hold:

- The provider only ever sees **citation aliases** (`[M3]`), never real message IDs; the
  alias→message-ID map is added server-side into the encrypted payload and never sent to the
  provider.
- Redaction placeholders inside the messages are preserved verbatim by the compaction prompt and
  recorded in the glossary, so a compacted summary never re-introduces a value the user redacted.

The endpoint must not log request messages, prior-summary content, or provider output.

### 15.3 Curated ("manual") memory

A user can pin a snippet of a message to the conversation's memory ("Add to memory"). This is stored
as a compaction record with an empty covered-message set — a **client-encrypted** payload sealed to
the conversation public key and POSTed as ciphertext (no provider call). The server stores opaque
bytes only, exactly like a model-generated compaction. Editing memory re-encrypts the payload
client-side and replaces the ciphertext via a PATCH; the server never sees the edited plaintext.

## 16. User- and project-scoped memory, and scoped redaction

Pinned memory and its redaction can be scoped beyond a single conversation: to the **user** (follows
them across all chats) or to a **project** (shared by the project's conversations). All scopes are
client-encrypted and combined into the injected context when sending a message. See
`docs/specs/client-side-compaction.md` §16.

### 16.1 Scoped memory storage

| Scope        | Collection                 | Encryption                                                      | Access gate                     |
| ------------ | -------------------------- | --------------------------------------------------------------- | ------------------------------- |
| Conversation | `conversation_compactions` | sealed to the conversation public key                           | active conversation participant |
| User         | `user_memory`              | sealed to the **user's own vault public key** (sole party)      | the owning user                 |
| Project      | `project_memory`           | `secretBox` under the **project content key** (held by members) | active project member           |

All three store only ciphertext; the server never holds plaintext memory at any scope. Project
public sharing is a non-goal, and project-scoped writes require active membership, so the content
key is an appropriate sealing key for project memory.

### 16.2 Scoped redaction keys and entries

So a placeholder pinned to user/project memory hydrates wherever that scope is shown — not only the
conversation it was minted in — redaction is **scope-aware**, mirroring the conversation model
(§14.2):

- **User redaction** (`user_redaction_entries`): each token→original mapping is sealed to the
  **user's own public key**. The user is the only party, so no separate keypair is needed.
- **Project redaction** (`project_redaction_keys` + `project_redaction_entries`): a per-project
  redaction **keypair independent of the project content key**, with the secret wrapped (sealed) to
  each active member's personal key — exactly the independence property of §14.2. Mappings are
  sealed to the project redaction public key. Keeping the redaction key independent of the content
  key preserves the option of a future "redacted-only" project reader who can see project content
  but not PII, and means content-key access alone never unlocks un-redaction.

Both new entry stores hold only the plaintext token string plus the sealed original; the server can
associate a token with a user/project but cannot read the value. All collections have `null` API
rules and are gated by ownership (user) or active membership (project) in `/api/v1` handlers.

### 16.3 Hydration union and the no-leak guarantee

When a token is encountered for display, the client resolves it against the **union** of the
conversation's, the project's, and the user's redaction entries. This is display-only and never
mutates stored data.

The provider-exposure guarantee holds across every scope: memory is injected into a completion in
its **redacted (placeholder) form**, so a provider never receives a user/project-pinned PII value in
the clear. A snippet is re-redacted **in its target scope** before storage, so the original lives
only in that scope's sealed entries. (If the model echoes a placeholder back, the client hydrates it
from the union above.)

### 16.4 Limitations

- A project's redaction secret is currently wrapped for the **creating member** only; other members
  see placeholders until participant re-wrapping lands — the same MVP limitation conversation
  redaction has (§14.4). It is a UX/coverage limit, not a leak: no member ever receives a value they
  shouldn't, and provider exposure is unaffected.
- Scoped redaction inherits the best-effort detection caveat (§14.1): only recognised
  high-confidence values are tokenised.

## 17. Open limitations

This model does **not** attempt to protect against a malicious server during live completion
requests, because the backend must see plaintext to call AI providers (this includes the compaction
completion call, §15.2). Browser PII redaction (§14, §16) narrows this exposure for detected
high-confidence values, which are replaced with placeholders before the request leaves the device.

This model is designed to protect against:

- database compromise
- storage-layer compromise
- accidental internal access to stored chat history
- server-side compromise that does not also obtain the user's Account Key

## 18. Related implementation areas

Primary implementation areas:

- `backend/internal/crypto/`
- `backend/internal/chat/`
- `backend/internal/auth/`
- `backend/cmd/api/routes.go`
- `frontend/src/app/services/vault.service.ts`
- `frontend/src/app/services/trusted-unlock.service.ts`
- `frontend/src/app/services/conversation.service.ts`
- `frontend/src/app/services/crypto.service.ts`
- `frontend/src/app/services/message.service.ts`
- `frontend/src/app/interfaces/model.ts`
- `backend/internal/handler/secure_records.go` (VaultSession{Get,Upsert,Delete})
- `backend/db/migrations/*_created_vault_session_wrap_keys.go`

Compaction, memory, and scoped redaction (§15–§16):

- `backend/internal/compaction/` (payload, prompt, parse, repo, encryption)
- `backend/internal/handler/compaction.go`, `scoped_memory.go`, `scoped_redaction.go`
- `backend/internal/handler/redaction.go` (conversation redaction)
- `backend/db/migrations/*_created_conversation_compactions.go`, `*_created_scoped_memory.go`,
  `*_created_redaction_collections.go`, `*_created_scoped_redaction.go`
- `frontend/src/app/services/compaction.service.ts`, `scoped-memory.service.ts`,
  `redaction.service.ts`
- `frontend/src/app/components/chat/conversation-memory/`,
  `frontend/src/app/components/chat/message-list-item/message-list-item.component.ts`

Update this document if the actual implemented trust model changes.
