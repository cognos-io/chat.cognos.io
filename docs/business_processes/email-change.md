---
description: Email change is enabled via PocketBase's verified request→confirm flow; only unverified direct PATCH is blocked
name: email-change
---

# Email Change

Email change is **enabled** through PocketBase's verified flow:
`request-email-change` emails a confirmation link to the **new** address, and
`confirm-email-change` applies the change once the Account holder confirms with
that token plus their current Account password.

Why this is safe under `account_key_v2`: the email is authentication-only
metadata — it is **not** an input to any key derivation — so changing it never
affects encrypted-data access. A direct PATCH of `users.email` (which would skip
verification) stays blocked by `ForbidUserEmailChanges`; changes must go through
the verified flow.

See `backend/internal/hooks/user_email.go` and
`backend/cmd/api/user_email_change_test.go`.
