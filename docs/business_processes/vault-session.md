---
description: Server-side cached AES wrap key that lets a returning session reopen the local vault without re-deriving from password
name: vault-session
---

# Vault Session

The frontend's vault is encrypted with a key derived from the user's password
(Argon2id). To avoid forcing the user to re-enter their password every time
they refresh the tab, the wrapped vault key is encrypted **once more** with a
random 32-byte AES key, and that AES "wrap key" is uploaded to
`/api/v1/vault-session` and stored in the `vault_session_wrap_keys` table.

The session cookie controls whether the wrap key is fetchable; the wrap key
itself is useless without the encrypted vault material held client-side.

Endpoints:

| Method   | Path                    | Behaviour                                                        |
| -------- | ----------------------- | ---------------------------------------------------------------- |
| `GET`    | `/api/v1/vault-session` | Returns `{wrap_key}` or 404                                      |
| `PUT`    | `/api/v1/vault-session` | Upsert; `wrap_key` must be exactly 44 chars (base64 of 32 bytes) |
| `DELETE` | `/api/v1/vault-session` | Idempotent revoke (returns 204 even if absent)                   |

The wrap key is automatically deleted on
[logout](./logout-token-rotation.md). The strict 44-byte length check at the
write boundary keeps malformed payloads out without a runtime length check.
