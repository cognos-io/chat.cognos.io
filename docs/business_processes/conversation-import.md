---
description: ChatGPT and Claude exports are parsed and encrypted in the browser, then persisted as one idempotent standalone Conversation transaction
name: conversation-import
---

# Conversation Import

Conversation import accepts ChatGPT and Claude exports. Parsing, selection and encryption happen in
the browser; the backend receives only ciphertext, generated IDs, the source enum and Message graph
links.

For each selected Conversation the browser generates a fresh Conversation key, encrypts metadata
and every Message, then sends one `POST /api/v1/conversation-imports` request.

The backend:

1. requires an authenticated Account and source `chatgpt` or `claude`
2. accepts 1–10,000 Messages whose parent appears before its child
3. rejects duplicate or colliding Conversation and Message IDs
4. writes the Conversation, creator Admin Participant, key rows, Messages and import receipt in one
   transaction
5. returns the original result when the same `import_id` and request digest are retried
6. returns `409` when an `import_id` is reused for different content

No partial import survives a failed transaction. Imports are standalone Conversations; moving them
to a Project is a separate [Conversation Project membership](./conversation-project-membership.md)
operation.
