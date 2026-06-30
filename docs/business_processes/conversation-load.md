---
description: Loading the conversation list returns each conversation's current-generation key material inline, so the client decrypts without per-conversation key requests
name: conversation-load
---

# Conversation Load

The sidebar must decrypt every conversation's title to render it, which needs that conversation's
keypair. The **rule**: the keys travel **with the list**, not as follow-up requests.

`GET /api/v1/conversations` returns, per conversation, the encrypted `data` **and** the current
key material the requesting user needs to decrypt it:

- `public_key` + `public_key_signature` (current generation);
- `wrapped_secret_key` wrapped for **this user only**, at the conversation's current `key_version`.

This mirrors the project-conversation list, which already embeds
`wrapped_conversation_secret_key`. The standalone per-conversation `GET …/public-key` and
`GET …/secret-key` endpoints stay for writes, rotation, copy/share, and as a fallback when the list
omits a conversation's keys — but they are **off the bulk load path**.

Why: fetching keys per-conversation turned one load into `~4N` requests (a public-key GET, a
secret-key GET, and a CORS preflight each). One batched read is the invariant.

## Rules

- The list embeds only the **requesting user's** wrapped secret key — never another participant's.
- Only the conversation's **current** `key_version` material is embedded (see
  [key-version-read-gate](./key-version-read-gate.md)); stale generations stay invisible.
- A conversation missing current-generation keys omits its key fields; the client falls back to the
  per-conversation endpoints for that one rather than failing the whole list.
- Embedding adds no rows the user could not already read; it must not widen access.

```mermaid
flowchart LR
  Q[GET /api/v1/conversations] --> A[authorise: user's conversations only]
  A --> J[join current-gen public_key + this user's wrapped secret_key]
  J --> R[list: data + key material per conversation]
  R --> D[client verifies sig, unwraps key, decrypts title<br/>no follow-up key requests]
```

See:

- [conversation-load-request-reduction](../specs/conversation-load-request-reduction.md)
- [encrypted-api-response-caching](../specs/encrypted-api-response-caching.md)
- [key-version-read-gate](./key-version-read-gate.md)
