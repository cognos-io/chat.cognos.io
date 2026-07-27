---
description: Password reset is enabled; the password only authenticates and never affects encrypted data
name: password-reset
---

# Password Reset

Password reset is **enabled**. `requestPasswordReset` emails a reset link and
`confirmPasswordReset` sets the new password through PocketBase's standard flow.

Why this is safe under `account_key_v2`: the password **only authenticates
sign-in** — it is not an input to any data-encryption key. The Account Key
(which the server never sees) is the sole secret that unwraps the private-key
backup. So resetting the Account password never re-wraps key material or touches
encrypted Conversations; it only changes the sign-in credential.

Losing the **Account Key**, by contrast, makes encrypted data unrecoverable —
the password cannot substitute for it.

**OAuth-only Accounts** have no Cognos password. A reset request for their email
returns the same neutral response as an unknown or password Account, but Cognos
sends no reset email and creates no usable reset token. This avoids revealing
whether the email has an Account or which sign-in method it uses. The Account
holder recovers Google access through Google's own account recovery.

Linked Accounts (password + Google) may reset the Cognos password as above.
Resetting it does not change or remove the exact linked Google identity. See
[Google OAuth sign-in](./oauth-google-sign-in.md).

See `backend/cmd/api/password_reset_test.go`, the auth e2e specs, and
`docs/security-model.md` §9/§10.
