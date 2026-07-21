---
description: Account and Conversation retention settings permanently delete inactive Conversations after their effective window while ambiguity always keeps data
name: conversation-retention
---

# Conversation Retention

Retention permanently deletes a Conversation and its cascading Messages, keys, Participants and
Public shares after a chosen number of inactive days.

The effective setting is:

| Conversation setting | Result                                      |
| -------------------- | ------------------------------------------- |
| `0`                  | Inherit the Account or Organisation default |
| `-1`                 | Never delete                                |
| `1..3650`            | Delete after that many inactive days        |

An Account default of `0` means never delete. An Organisation policy supplies the inherited default
for an Organisation Project.

The deadline is measured from `last_activity_at`, not the time the setting changed. Updating
retention must not extend a Conversation's life by touching activity. A scheduled job runs every
30–60 minutes and deletes only rows whose effective window has definitely elapsed; a missing or
invalid activity timestamp fails safe by keeping the Conversation.

This process is different from [disappearing Messages](./expired-message-cleanup.md), which deletes
individual Messages using their plaintext `expires` timestamp.
