# Cognos Security Model

**Status:** Planned / source of truth for the rework
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
- unlocking a new device requires **account password + Account Key**

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

Cognos uses a **1Password-style Account Key model**.

Users have two secrets:

1. **Account password**
   - user-chosen
   - used for authentication
2. **Account Key**
   - high-entropy generated secret
   - required to unlock a new device
   - intended to materially improve security against server-side compromise and database theft

### Design goals

- support cross-device access
- avoid storing plaintext private keys on the server
- avoid relying on the login password alone to unlock encrypted private-key backups
- make compromise of the auth database insufficient to decrypt user private keys

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

Users should not need to repeatedly enter the Account Key on a device they trust.

Trusted devices may cache a **locally wrapped unlock blob** in **IndexedDB**.

That local cache should be cleared or invalidated when:

- the user explicitly locks the account
- the user logs out
- the browser storage is cleared
- the device is intentionally de-authorized in future account-management flows

Do **not** use `localStorage` for key material.

## 9. Onboarding and recovery expectations

### Onboarding

On first setup, the client should:

- generate the user's keypair
- generate the Account Key
- show the Account Key clearly to the user
- require the user to save it
- encrypt private-key material client-side before upload

### Recovery

If a user loses:

- **password only**: auth recovery may be possible depending on auth design, but encrypted data must
  remain protected
- **Account Key only**: cross-device unlock may be impossible
- **password and Account Key**: encrypted data recovery may be impossible

This is an intentional tradeoff in favor of privacy.

## 10. Password change, email change, logout, lost device

### Password change

Changing the account password must:

- re-wrap encrypted unlock material client-side or through a safe authenticated flow
- avoid re-encrypting all historical messages

### Email change

Changing email must:

- not affect encrypted data access
- not be part of vault-key derivation in any destructive way

### Logout / lock

Logging out or explicitly locking should:

- remove trusted-device unlock state from the current device
- require unlock again before local decryption resumes

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
- **"Trusted devices can stay unlocked locally until you lock the account or clear the device."**

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
- `frontend/src/app/services/conversation.service.ts`
- `frontend/src/app/services/crypto.service.ts`
- `frontend/src/app/services/message.service.ts`
- `frontend/src/app/interfaces/model.ts`

Update this document if the actual implemented trust model changes.
