---
description: How highlighted message text is sealed client-side, stored as an owner-scoped bookmark, and re-anchored for list, jump and highlight views
name: bookmarks
---

# Bookmarks

Bookmarks let a user highlight text in a message, save that span, browse it from
`/account/bookmarks`, then jump back to the original message with the same span
highlighted again. The selected text is chat content, so Cognos treats it like
private data: the browser seals the bookmark payload to the user's vault key
before the backend sees it.

The backend only stores the owner, conversation id, message id and opaque
bookmark data. The quote, surrounding context and optional note are never
plaintext at rest.

```mermaid
sequenceDiagram
  autonumber
  participant UI as Message selection
  participant B as BookmarkService
  participant API as /api/v1/bookmarks
  participant DB as PocketBase
  participant H as Highlight engine

  UI->>UI: user highlights rendered message text
  UI->>B: quote + prefix + suffix + message id
  B->>B: seal payload to user's vault public key
  B->>API: POST conversation, message, sealed data
  API->>API: auth + conversation access check
  API->>DB: INSERT owner-scoped user_bookmarks row
  API-->>B: bookmark id + sealed data
  B->>B: cache decrypted bookmark locally
  B->>H: locate quote in current rendered text
  H->>UI: apply CSS Custom Highlight when found
```

## Re-anchoring

A bookmark stores a text-quote-with-context selector:

- `quote` — the exact selected text.
- `prefix` — up to 32 characters before the quote.
- `suffix` — up to 32 characters after the quote.

The client does **not** store rendered DOM offsets. Messages are rendered from
markdown and may include redaction pills, citations and hydrated/dehydrated
content. Numeric offsets would drift. On load, the client searches the rendered
plain text for the quote and uses the prefix/suffix to pick the right occurrence
when the same text appears more than once.

```mermaid
flowchart LR
  A[List bookmarks] --> B[Decrypt each sealed payload]
  B --> C[Open target conversation]
  C --> D[Scroll to stored message id]
  D --> E[Read rendered message text]
  E --> F{Quote found?}
  F -- yes --> G[Apply persistent highlight]
  F -- no --> H[Show bookmark without highlight]
```

## Invariants

1. **Bookmark text is client-encrypted.** The quote, context and note live inside
   a sealed payload. The server stores opaque base64 in `user_bookmarks.data`.
2. **Access is checked before create.** A user can only create a bookmark for a
   conversation they can access. Missing and inaccessible conversations both
   return a neutral `404`.
3. **Listing and deletion are owner-only.** Users only see their own bookmarks;
   deleting a foreign or missing bookmark returns the same neutral `404`.
4. **A failed re-anchor never guesses.** If the quote no longer appears, the UI
   does not highlight a nearby or unrelated span.
5. **Bookmarks are not conversation members.** The row is user-scoped and only
   links to conversation/message ids so the client can jump back.

## Not yet wired

- Bookmark payloads have room for `note`, but the current capture flow does not
  expose note editing.
- Co-participants do not share bookmarks. A bookmark belongs to the user who
  saved it, even when the underlying conversation is shared.
