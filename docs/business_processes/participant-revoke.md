---
description: Admin-only soft-revoke that stamps removed_at — preserving the audit row — and triggers a key rotation flow client-side
name: participant-revoke
---

# Revoke Participant

`DELETE /api/v1/conversations/{id}/participants/{userID}` stamps `removed_at`
on the matching active row. The historical row is **kept**: it's the audit
trail of "who was once allowed".

Guards:

- Caller must be an `Admin` participant (`403` otherwise).
- Caller cannot revoke themselves (`400`). Self-leave is intentionally
  blocked here because the Admin-only path can't tell whether the caller is
  the last Admin without extra reads; a future "leave conversation" UX must
  enforce the last-Admin invariant separately.
- Target must currently be active (`404` otherwise via
  `ErrParticipantNotFound`).

```mermaid
flowchart LR
  A[Admin DELETE .../participants/{u}] --> B{caller=Admin?}
  B -- no --> C[403]
  B -- yes --> D{target = caller?}
  D -- yes --> E[400 cannot revoke self]
  D -- no --> F[UPDATE participants<br/>SET removed_at = now]
  F --> G[204]
```

Revocation removes access **immediately** for new reads (see
[participant-access-control](./participant-access-control.md)). Existing
wrapped secret keys held by the revoked user remain valid for the data
they've already pulled — that's what
[conversation-key-rotation](./conversation-key-rotation.md) is for: cut the
revoked user out of all future messages by bumping `key_version`.
