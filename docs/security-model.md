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
- model IDs, token counts, provider metadata, and cost metadata
- encrypted private-key backup ciphertext
- public keys

### The server cannot see at rest

- plaintext stored chat history
- plaintext stored conversation titles
- plaintext stored private keys

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

- use a **random per-user salt** for password-based derivation
- email changes must not break cryptographic access
- password changes should re-wrap key material rather than re-encrypt all user data

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

**Explicitly out of scope for this iteration:**

- Idle-TTL on the wrap key (server-side auto-expiry after N minutes of inactivity). Token expiry on
  the auth session handles bounded revocation; a tighter idle window is a future tightening.
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

Changing email must:

- not affect encrypted data access
- not be part of vault-key derivation in any destructive way

### Logout / lock

Current implementation guarantees that logging out or explicitly locking the account:

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

## 14. Open limitations

This model does **not** attempt to protect against a malicious server during live completion
requests, because the backend must see plaintext to call AI providers.

This model is designed to protect against:

- database compromise
- storage-layer compromise
- accidental internal access to stored chat history
- server-side compromise that does not also obtain the user's Account Key

## 15. Related implementation areas

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

Update this document if the actual implemented trust model changes.
