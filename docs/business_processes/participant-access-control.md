---
description: All conversation reads, messages, and completions are gated on an active participant row — not the legacy creator field
name: participant-access-control
---

# Participant Access Control

Every conversation-scoped endpoint resolves access through the same helper:

```text
participants.Repo.IsActive(conversationID, userID) bool
```

A row counts as "active" iff `removed_at = ''`. Revoked members keep a
historical row for audit but lose access immediately.

| Endpoint                                            | Result for non-participant              |
| --------------------------------------------------- | --------------------------------------- |
| `GET/PATCH/DELETE /conversations/{id}`              | `404 Conversation not found`            |
| `GET /conversations/{id}/messages`                  | `404`                                   |
| `GET/POST/DELETE /conversations/{id}/participants*` | `404`                                   |
| `POST /conversations/{id}/complete`                 | `404` (checked BEFORE the gateway call) |
| `POST /conversations/{id}/rotate`                   | `404`                                   |

**Why 404 not 403**: the response must not reveal whether the conversation
id is valid. A 403 would let an attacker probe for live conversation IDs.

The completion handler explicitly performs `IsActive` **before** consulting
the conversation record so the existence-leak window is also closed for
the gateway path.
