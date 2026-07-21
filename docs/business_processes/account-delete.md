---
description: Account deletion removes the Account and encrypted product data while retaining detached financial records required for billing, tax, fraud prevention or legal compliance
name: account-delete
---

# Account Delete

`DELETE /api/v1/account` permanently deletes the Account and encrypted product
data that belongs to it.

Deletion is intentionally blocked while the Account has an active paid Plan. The
Account holder must cancel or resolve billing first, so subscription ownership
and payment obligations are not orphaned.

> **Known P0 defect:** the current handler still assumes every Project is
> personal. It deletes every Project whose `creator` is the caller, including an
> Organisation-owned shared Project created by an ordinary member. An
> Organisation Owner instead receives a generic failure from the required owner
> relation. Treat Account deletion as unsafe for Accounts with Organisation
> relationships until [OP-001](../open-points.md#op-001-account-deletion-and-organisation-data)
> is fixed and tested.

Deletion is a step-up operation. The request body must contain the current
Account password. When authenticator-app MFA is enabled, it must also contain a
current six-digit code. The server verifies both immediately before checking
billing state and deleting data; a bearer token alone is insufficient.

```mermaid
flowchart LR
  A[DELETE /api/v1/account] --> S{password and MFA valid?}
  S -- no --> R[400 deletion refused]
  S -- yes --> B{paid plan active?}
  B -- yes --> C[409 billing must be resolved]
  B -- no --> D[delete Account-owned product data]
  D --> E[detach retained financial records]
  E --> F[204]
```

Deleted product data includes encrypted Conversations, Messages, key material,
Personas, Bookmarks, Library Attachments, memory, Redaction mappings, Vault
sessions, and MFA records owned by the Account.

Some records may be retained after deletion when required for billing, tax,
fraud prevention, or legal compliance. Those financial records are detached from
the deleted Account rather than keeping the Account active.

Losing the Account Key is not an account-deletion path: the Account holder can
still sign in and manage billing or delete the Account, but encrypted data is
unrecoverable without the Account Key.
