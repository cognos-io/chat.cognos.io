---
description: Sidebar search builds a browser-only BM25 index over decrypted chat titles and lazily hydrated recent messages
name: conversation-search-index
---

# Conversation Search Index

Sidebar search is **on-device**.

The server returns the same encrypted conversations and messages it already does. The browser
decrypts what the signed-in user can access, builds a temporary Orama BM25 index, and throws it away
when the vault locks or the user logs out.

```mermaid
sequenceDiagram
  autonumber
  participant FE as Browser
  participant API as Cognos API
  participant DB as PocketBase

  FE->>API: list conversations / project conversations
  API->>DB: read authorised ciphertext rows
  API-->>FE: encrypted conversation records
  FE->>FE: decrypt titles + build title index
  FE->>FE: user types search
  FE->>FE: return title matches immediately
  FE->>API: JIT fetch recent encrypted messages for candidate chats
  API-->>FE: encrypted message page
  FE->>FE: decrypt recent messages + update BM25 index
  FE->>FE: rerank results
```

## Rules

- Index **titles immediately** after conversation decryption.
- Index **recent messages lazily** when the user searches or the browser is idle.
- Index conversation **title + message content only**.
- Search runs after a **3-character minimum** and a **400 ms debounce**; it requires **all** query
  terms (BM25 `threshold: 0`).
- Stem with the user's **active UI language** — one stemmer per index, rebuilt on locale change.
- **Eagerly load project conversations** on the first search of a session.
- Cache hydrated message text **in memory only** for V1; the Orama index itself is the cache.
- Invalidate a chat's cached search text when its `last_activity_at` or `updated` value changes.
- Clear the whole index on vault lock, logout, or account switch.
- Do not index deleted-message content, reasoning text, or attachment text in V1.
- Do not log queries, titles, messages, snippets, or Orama documents.

## Ranking rule

Use Orama BM25 with title boosted above message content:

```txt
title > recentMessages
```

A title match should normally outrank a match buried in recent message text.

## Security invariant

> Search must never create a durable plaintext copy of chat content.

No plaintext search index in the backend. No plaintext search cache in localStorage or IndexedDB.

## Related caching rule

Search hydration may benefit from browser/CDN caching of encrypted API responses, but that is a
separate platform concern. It needs principal-scoped keys, endpoint-specific TTLs, and purge tests.

See:

- [conversation-search](../specs/conversation-search.md)
- [encrypted-api-response-caching](../specs/encrypted-api-response-caching.md)
