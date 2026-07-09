---
description: All conversation reads, messages, and completions are gated on an active participant row — not the legacy creator field
name: participant-access-control
---

# Participant Access Control

Every conversation-scoped endpoint resolves access through the same helper:

```text
participants.Repo.IsActive(conversationID, userID) bool
```

A row counts as "active" iff `removed_at = ''`. Revoked Participants keep a
historical row for audit but lose access immediately. Revocation is not a
standalone operation — it only happens as part of
[conversation-key-rotation](./conversation-key-rotation.md), which stamps
`removed_at` and re-keys the conversation in a single transaction so the
revoked Participant has no decryption material for any future Message.

| Endpoint                                     | Result for non-participant              |
| -------------------------------------------- | --------------------------------------- |
| `GET/PATCH/DELETE /conversations/{id}`       | `404 Conversation not found`            |
| `GET /conversations/{id}/messages`           | `404`                                   |
| `GET/POST /conversations/{id}/participants*` | `404`                                   |
| `POST /conversations/{id}/complete`          | `404` (checked BEFORE the gateway call) |
| `POST /conversations/{id}/rotate`            | `404`                                   |

**Why 404 not 403**: the response must not reveal whether the conversation
id is valid. A 403 would let an attacker probe for live conversation IDs.

The completion handler explicitly performs `IsActive` **before** consulting
the conversation record so the existence-leak window is also closed for
the gateway path.

## Attachments are owner-scoped, not participant-scoped

The attachment library is a **separate access model**: the `/api/v1/attachments/*`
endpoints gate on file **ownership** (`user_attachments.owner == caller`), not on
conversation participation, and return `404` to anyone else so ids never leak. An
Account holder references their own files in any Conversation they participate in;
they can never read another Account holder's file. Consequently a co-participant — or a public-share
viewer — cannot decrypt a file another participant attached: the message shows a
**"private file attached"** cue instead of the contents, decided from the message
sender's identity (never by probing the backend). The `attachment_usages`
("used in") lookup is likewise owner-gated. See
[attachment-processing](./attachment-processing.md).
