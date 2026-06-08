---
description: Email address changes are rejected until account-key re-auth is implemented
name: email-change-blocked
---

# Email Change Blocked

Both the request-email-change and confirm-email-change flows return `400`
unconditionally. Direct edits to `users.email` via `OnRecordUpdateRequest`
are also rejected by comparing `Original().Email()` to the incoming value.

Why: Cognos uses the user's email as the authentication identity and as the
salt context for the trial-seed override system. Changing it without proving
possession of the account's keys could let an attacker fork a vault. Until a
re-auth-with-vault-key flow lands, the safe default is to reject any change.

This is a **temporary policy** — see [`backend/internal/hooks/user_email.go`]
and [`user_email_change.go`] — and should be revisited when vault recovery
ships.
