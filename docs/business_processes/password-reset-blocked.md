---
description: Password reset endpoints are disabled until vault recovery is implemented
name: password-reset-blocked
---

# Password Reset Blocked

Both `requestPasswordReset` and `confirmPasswordReset` hooks return `400`
with the message _"password reset is unavailable until vault recovery is
implemented"_.

Why: the user's password derives the symmetric key that unwraps their vault
(via Argon2id — see [`vault-session`](./vault-session.md)). Letting Pocketbase
reset the password through email confirmation alone would let an attacker who
controls the inbox bypass the vault — they would set a new password but the
vault would be unreadable, soft-bricking the account, or worse, a future
implementation that re-encrypts the vault on reset would let inbox access
replace the encryption key entirely.

A future "vault recovery" flow must re-establish ownership of the encryption
material before allowing a new password. Until then, password reset is closed.
