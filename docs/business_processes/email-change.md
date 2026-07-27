---
description: Password and Linked Accounts may change email through PocketBase's verified flow; OAuth-only Accounts cannot
name: email-change
---

# Email Change

Email change is enabled for **password-only and Linked Accounts** through
PocketBase's verified flow:
`request-email-change` emails a confirmation link to the **new** address, and
`confirm-email-change` applies the change once the Account holder confirms with
that token plus their current Account password.

Why this is safe under `account_key_v2`: the email is authentication-only
metadata — it is **not** an input to any key derivation — so changing it never
affects encrypted-data access. A direct PATCH of `users.email` (which would skip
verification) stays blocked by `ForbidUserEmailChanges`; changes must go through
the verified flow.

## OAuth-only Accounts

OAuth-only Accounts have no Account password, so email change is unavailable.
The UI must not offer the flow, and the backend must not send an email-change
message for these Accounts. The Account holder manages their Google identity
through Google; Cognos continues to recognise the exact linked Google provider
identity ID rather than treating a matching email as proof.

Linked Accounts use their Account password for email change. Changing the Cognos
email does not move, replace, or remove their linked Google identity.

See `backend/internal/hooks/user_email.go`, `backend/internal/hooks/oauth.go`, and
`backend/cmd/api/user_email_change_test.go`.
