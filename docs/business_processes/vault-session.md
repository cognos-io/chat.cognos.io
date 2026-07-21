---
description: Server-side cached AES wrap key that lets a returning session reopen the local Vault without re-entering the Account Key
name: vault-session
---

# Vault Session

The frontend **Vault** unlock key is derived from the **Account Key** (Argon2id). To avoid
forcing the Account holder to re-enter their Account Key every time they refresh the tab, the
wrapped unlock key is encrypted **once more** with a random 32-byte AES key, and that AES "wrap
key" is uploaded to `/api/v1/vault-session` and stored in the `vault_session_wrap_keys` table.

The Account's bearer auth token controls whether the wrap key is fetchable; the wrap key itself is
useless without the encrypted Vault material held client-side.

Endpoints:

| Method   | Path                    | Behaviour                                                        |
| -------- | ----------------------- | ---------------------------------------------------------------- |
| `GET`    | `/api/v1/vault-session` | Returns `{wrap_key}` or 404                                      |
| `PUT`    | `/api/v1/vault-session` | Upsert; `wrap_key` must be exactly 44 chars (base64 of 32 bytes) |
| `DELETE` | `/api/v1/vault-session` | Idempotent revoke (returns 204 even if absent)                   |

The wrap key is automatically deleted on
[logout](./logout-token-rotation.md). The strict 44-byte length check at the
write boundary keeps malformed payloads out without a runtime length check.

Every successful read refreshes `last_used_at`. A jittered hourly job deletes wrap keys idle for
more than 30 days, so abandoned devices do not retain the server half indefinitely.
