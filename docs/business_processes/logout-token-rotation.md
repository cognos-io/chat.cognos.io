---
description: Logout rotates the Account holder's auth token key, clears the Vault wrap key and revokes trusted MFA devices
name: logout-token-rotation
---

# Logout Token Rotation

`POST /v1/auth/logout` performs three security resets on behalf of the caller:

1. **Rotate `tokenKey`** on the user record via `re.Auth.RefreshTokenKey()` +
   `app.Save`. Every Pocketbase auth token signed under the previous tokenKey
   is now invalid, immediately revoking any still-live sessions for that Account holder.
2. **Delete the vault session wrap key** from `vault_session_wrap_keys` so
   the server stops holding the convenience cache that would otherwise let
   the next session re-open the Vault without re-entering the Account Key.
3. **Revoke every trusted MFA device** so future password sign-ins must complete a new TOTP
   challenge before another device can be remembered.

```mermaid
sequenceDiagram
  participant FE
  participant BE
  participant DB
  FE->>BE: POST /v1/auth/logout (Bearer)
  BE->>DB: rotate users.tokenKey
  BE->>DB: DELETE vault_session_wrap_keys WHERE user = caller
  BE->>DB: DELETE mfa_trusted_devices WHERE user = caller
  BE-->>FE: 204
```

Why all three: rotating tokenKey alone would leave the wrap key cached server-side, so a stolen DB
snapshot could still Unlock the Vault for someone with the Account holder's local Vault ciphertext
and a valid auth token to fetch the wrap key. Deleting the wrap key alone would still leave any
exfiltrated bearer token usable. Retaining trusted MFA devices would silently waive a future second
factor. Logout resets every convenience credential.
