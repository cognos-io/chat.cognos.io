---
description: Account and Project memory keep encrypted context that the browser decrypts, combines and Redacts before a Completion
name: scoped-memory
---

# Account and Project Memory

Memory stores facts, preferences, decisions or standing instructions for future Completions.

| Scope   | Encryption                           | Access                      | Used in                                                     |
| ------- | ------------------------------------ | --------------------------- | ----------------------------------------------------------- |
| Account | Sealed to the Account key pair       | Owning Account only         | The Account's eligible Conversations when memory is enabled |
| Project | Sealed under the Project content key | Active Project Participants | Conversations in that Project                               |

The backend stores opaque memory data and plaintext routing metadata only. On send, the browser
loads and decrypts applicable Account, Project and Conversation memory, combines it with the active
Message branch, then applies Redaction before the request leaves the device.

Account memory uses `/api/v1/user-memory`. Project memory uses
`/api/v1/projects/{projectID}/memory` for create/list and `/api/v1/project-memory/{id}` for
update/delete. Every write carries client-encrypted data; Project routes use the same role and
`rotation_pending` write gates as other Project content.

Deleting or changing memory affects future Completions only. Past Messages and existing Compactions
are not rewritten. Conversation-specific manual and generated memory is covered by
[Conversation compaction](./conversation-compaction.md).
