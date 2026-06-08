---
description: Logout rotates the user's auth token key and clears their cached vault wrap key
name: logout-token-rotation
---

# Logout Token Rotation

`POST /v1/auth/logout` performs two writes on behalf of the caller:

1. **Rotate `tokenKey`** on the user record via `re.Auth.RefreshTokenKey()` +
   `app.Save`. Every Pocketbase auth token signed under the previous tokenKey
   is now invalid, immediately revoking any still-live sessions for that user.
2. **Delete the vault session wrap key** from `vault_session_wrap_keys` so
   the server stops holding the convenience cache that would otherwise let
   the next session re-open the vault without re-deriving from password.

```mermaid
sequenceDiagram
  participant FE
  participant BE
  participant DB
  FE->>BE: POST /v1/auth/logout (Bearer)
  BE->>DB: rotate users.tokenKey
  BE->>DB: DELETE vault_session_wrap_keys WHERE user = caller
  BE-->>FE: 204
```

Why both: rotating tokenKey alone would leave the wrap key cached server-side,
so a stolen DB snapshot could still unlock the vault for someone with the
user's password. Deleting the wrap key alone would still leave any
exfiltrated bearer token usable. Logout means **both** invariants reset.
