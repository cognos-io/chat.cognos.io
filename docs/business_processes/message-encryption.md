---
description: User and assistant message content is encrypted with the conversation's current public key before it ever touches durable storage
name: message-encryption
---

# Message Encryption

Every persisted message row has its `data` column populated with the
**base64 of a NaCl sealed box** of the JSON-encoded `MessageRecordData`,
encrypted against the conversation's current public key
(`box.SealAnonymous`, ephemeral sender keys).

Pipeline (per message):

```mermaid
flowchart LR
  P[plaintext MessageRecordData] --> J[json.Marshal]
  J --> S[box.SealAnonymous<br/>recipient = conversation public key]
  S --> B[base64 stdenc]
  B --> D[INSERT messages.data]
```

Properties this gives us:

- **No plaintext at rest.** The server stores only ciphertext bound to the
  conversation's recipient public key.
- **Forward access loss on rotation.** Once
  [conversation-key-rotation](./conversation-key-rotation.md) bumps the
  generation, new messages encrypt against the new public key — revoked
  participants can no longer decrypt them even if they kept the old wrapped
  secret key.
- **No sender keys to manage server-side.** SealAnonymous mints an
  ephemeral keypair per message; only the conversation's secret key
  (held by participants) can decrypt.

Persistence is done by `chat.PocketBaseMessageRepo.EncryptAndPersistMessage`,
called twice per completion (user message before gateway, assistant message
after). If the gateway call fails after the user message lands, the handler
deletes the user message to keep the conversation history clean.

## What lives in the blob vs. plaintext columns

Anything the **server** doesn't need to query goes inside the encrypted
`MessageRecordData` blob, so no extra metadata leaks at rest:

- `created_at` — an RFC 3339 timestamp, set by the backend (server clock) and
  encrypted into the blob. It is display-only; message **ordering** uses the
  `parent_message` linked list, not timestamps. The frontend reads it from the
  decrypted data (`MessageData.created_at`). There is deliberately **no**
  plaintext `created` column, so the server persists no per-message timing
  metadata.
- `expires` — by contrast, stays a **plaintext column**. The expiry-cleanup
  job (`FindExpiredMessages`) has to query it server-side, so it cannot be
  hidden in the blob. It carries only an expiry instant, not a send time.

`MessageRecordData` (backend `internal/chat/messaging.go`) and the frontend
`MessageData` zod schema must stay in sync — both carry `created_at` as an
optional field so messages written before it existed still decrypt.
