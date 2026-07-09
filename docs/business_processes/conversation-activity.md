---
description: Sidebar order is driven by user-visible conversation activity, not generic row updates
name: conversation-activity
---

# Conversation Activity

Sidebar recency uses `conversations.last_activity_at`.

This is **not** a plaintext-content signal. It only says "something visible in
this conversation changed".

## Bumps activity

- Conversation created.
- Message created (normal sends, assistant replies, regenerations, image replies).
- Message content changed (for example soft-delete tombstones or edited forks that create messages).
- Message deleted.
- Conversation title/data changed.

## Does not bump activity

- Keeping an expiring message by clearing `messages.expires`.
- Sharing metadata changes.
- Participant/key-management changes.
- Billing or analytics writes.

## Rule for new code

If a feature changes what the Account holder sees in the Conversation timeline, call
the conversation activity bump helper with a metadata-only reason. Never pass message
content, prompts, titles, emails, or decrypted data to that helper.
