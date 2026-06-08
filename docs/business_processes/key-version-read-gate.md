---
description: Public and wrapped secret key reads always return the row matching the conversation's current key_version — stale generations are invisible
name: key-version-read-gate
---

# Key Version Read Gate

Three tables carry a `key_version` column that ties a row to a specific
conversation generation:

| Table                      | Use of `key_version`                                                        |
| -------------------------- | --------------------------------------------------------------------------- |
| `conversations`            | The conversation's **current** generation (starts at 1, bumped by rotation) |
| `conversation_public_keys` | Generation the public key belongs to                                        |
| `conversation_secret_keys` | Generation the wrapped key was produced against                             |

Read endpoints (`GET /conversations/{id}/public-key`,
`GET /conversations/{id}/secret-key`, and the gateway path that loads the
recipient key for encryption) filter by **the conversation's current
generation**. Older rows stay in the DB as audit data but never surface:

- `auth.KeyPairRepo.ConversationPublicKey` sorts by `-key_version LIMIT 1`.
- `ownedConversationSecretKeyRecord` filters by
  `conversation = ? && user = ? && key_version = current`.

```mermaid
flowchart LR
  R[Rotation: conversations.key_version = N+1] --> A[INSERT public_key key_version=N+1]
  R --> B[INSERT secret_keys for each participant key_version=N+1]
  Q[GET /public-key] --> S[sort -key_version LIMIT 1 → row at N+1]
  Q2[GET /secret-key] --> S2[filter key_version = N+1 → row at N+1]
  H[Historical rows at key_version <= N] -.kept for audit.-> H
```

Why filter, not delete: a deleted row is a deleted audit trace. A filtered
row is invisible to the API but still answers "what key was in force on
date X?". The cost is one extra column and a slightly more specific query;
the value is that revocation + rotation never loses history.

Legacy rows with `NULL` or `0` are treated as **version 1** so pre-feature
data keeps working — the migration backfill stays an implementation detail.
