---
description: Projects group encrypted Conversations and memory behind Project membership, with Organisation-only sharing and forward-only key rotation
name: project-management
---

# Project Management and Sharing

A **Project** groups encrypted Conversations and Project-scoped memory. A Project is either personal
or owned by an Organisation. Access always comes from an active Project Participant row, except that
Organisation Owners and Admins receive administrative access without a redundant Participant row.

| Role   | May read | May create/edit | May share, rotate or delete |
| ------ | -------- | --------------- | --------------------------- |
| Viewer | Yes      | No              | No                          |
| Editor | Yes      | Yes             | No                          |
| Admin  | Yes      | Yes             | Yes                         |

Personal Projects start with the creator as Admin and are not shareable. Organisation Projects may
only add active members of the same Organisation. Adding a Participant and their client-wrapped
Project key is one transaction; a key without membership, or membership without a key, must never
survive.

Project Conversations inherit Project access and intentionally have no Conversation Participant
rows. Their Conversation secret key is wrapped by the current Project content key.

## Removal and rotation

Removing a Participant cuts API access immediately and marks the Project `rotation_pending`. Writes
remain blocked until an Admin browser:

1. generates the next Project content key
2. re-encrypts Project metadata
3. wraps the new key for every remaining Participant
4. re-wraps child Conversation keys
5. submits the complete rotation atomically

Previously downloaded content cannot be revoked. Rotation prevents the removed Participant from
decrypting content written after the new key version.

## Memory and movement

Project memory is encrypted under the Project key and may be injected into Completions after browser
decryption and Redaction. Conversations can be created inside a Project or moved between standalone
and Project scope through the transactional
[Conversation Project membership](./conversation-project-membership.md) process.

Shared Project files are not implemented; Attachments remain Account-owned. See
[OP-023](../open-points.md#data-documents-and-sharing).
