# Conversation Search — Orama BM25 Spec

**Status:** Draft  
**Scope:** Replace sidebar chat filtering with a browser-only Orama BM25 index that searches chat
titles immediately and recent decrypted messages lazily.

## 0. Read this first

V1 should be **client-side, encrypted-at-rest, and lazy**.

- Keep the backend ciphertext-only. No plaintext message search index on the server.
- Index chat **titles** as soon as conversations decrypt.
- Index **recent messages** only after the user searches or the browser is idle.
- Cache decrypted search text **in memory only** for V1.
- Use Orama BM25 ranking, not substring filtering.
- Do not implement embeddings or semantic search here.

## 1. Why change it

Today the sidebar search is a case-insensitive `title.includes(query)` filter in
`ConversationService`. That is fast, but it misses the real user need:

> “I remember we talked about the lease clause, but I do not remember the chat title.”

Orama gives us a local search engine in the browser, so the user can search decrypted data without
sending plaintext back to the API.

## 2. Current state

Relevant code today:

- `frontend/src/app/pages/chat/chat.component.html` has the sidebar search input.
- `ChatComponent.onSearchChange()` forwards raw text to `ConversationService.filter$`.
- `ConversationService.filteredConversations` filters standalone conversations by decrypted title
  only.
- Project conversations are loaded by `ProjectConversationService` and excluded from the main
  Pinned/Recent lists.
- Messages are fetched page-by-page with
  `GET /api/v1/conversations/{id}/messages?page=1&page_size=100` and decrypted in
  `MessageService` only for the selected conversation.

Important implication: search hydration must **not** call `MessageService` because that would mutate
current chat state. It needs its own stateless fetch/decrypt path or a small shared decrypt helper.

## 3. Orama facts we rely on

From Orama JS docs, especially <https://docs.orama.com/docs/orama-js/search/bm25>:

- Package: `@orama/orama`.
- Basic API: `create`, `insert` / `insertMultiple`, `search`, `remove`.
- Schema fields marked as `string` are searchable.
- `search(db, { term, properties, boost, threshold, relevance })` returns scored hits.
- BM25 settings live under `relevance`:
    - `k` default `1.2` — term-frequency saturation;
    - `b` default `0.75` — length normalisation;
    - `d` default `0.5` — frequency normalisation lower bound.
- Field boosting is supported, e.g. `boost: { title: 2 }`.
- Orama v3 methods are synchronous; large inserts should use `insertMultiple` with a small batch
  size to yield the event loop.
- Orama docs say updates are remove+insert aliases and recommend rebuilding when that is simpler.

## 4. Goals

- Search conversation titles and recent message content from the sidebar.
- Keep search fully on-device after encrypted records are fetched.
- Return useful ranking: title matches should beat message-only matches.
- Keep first keystroke fast by indexing titles first.
- Hydrate recent messages JIT without blocking typing.
- Cache hydrated message text for the active browser session.
- Include project conversations once their project keys and chats are loaded.
- Never log decrypted titles, messages, snippets, or query text.

## 5. Non-goals

- Server-side plaintext search.
- Persisting a plaintext search index in IndexedDB/localStorage.
- Searching every historical message before showing first results.
- Searching attachment extracted text in V1.
- Searching reasoning text in V1.
- Semantic/vector search.
- Replacing library/persona/model catalogue filters in this change. They can adopt Orama later if
  the pattern proves useful.

## 6. Product behaviour

### 6.1 Empty query

Keep today's navigation structure:

- Projects group;
- Pinned chats;
- Recent chats.

No Orama search result list is shown.

### 6.2 Non-empty query

Show one **Search results** conversation list ordered by Orama score, then recency as a tie-breaker.

Include:

- standalone conversations;
- loaded project conversations.

Do not require the user to expand a project before its loaded chats can match.

### 6.3 Loading states

The existing “searched on device” hint stays true and should remain visible.

Add only lightweight states if needed:

- “Searching recent messages…” while JIT hydration is running.
- “No matching chats” when the query has no hits after currently available hydration.

Do not show decrypted message snippets in V1. Returning the chat row is enough and avoids making the
sidebar unexpectedly reveal message bodies.

### 6.4 Internationalisation

Any new text must use Transloco and be translated in all supported languages:

- English (`en`)
- German (`de`)
- French (`fr`)
- Spanish (`es`)
- Portuguese (`pt`)
- Italian (`it`)

## 7. Search document shape

One Orama document per conversation:

```ts
{
  id: string;              // conversation id
  title: string;           // decrypted title
  recentMessages: string;  // joined recent decrypted message content; empty until hydrated
  updatedMs: number;       // for tie-breaks outside Orama
  projectId?: string;
}
```

Do not include:

- attachment text;
- reasoning text;
- deleted-message content;
- raw encrypted blobs;
- user ids, emails, billing data, or participant metadata.

Suggested Orama schema:

```ts
create({
  schema: {
    id: 'string',
    title: 'string',
    recentMessages: 'string',
    updatedMs: 'number',
    projectId: 'string',
  },
});
```

## 8. Ranking defaults

Start simple:

```ts
search(db, {
  term: query,
  properties: ['title', 'recentMessages'],
  boost: {
    title: 4,
    recentMessages: 1,
  },
  threshold: 0.6,
  relevance: {
    k: 1.2,
    b: 0.75,
    d: 0.5,
  },
});
```

Rationale:

- Titles are short and user-authored, so title hits should rank highest.
- Recent message text can be long, so title needs an explicit boost.
- Keep Orama BM25 defaults until tests or real usage show a problem.
- `threshold: 0.6` avoids very broad multi-word queries returning every chat that shares one common
  token.

Tune only with tests. Do not tweak BM25 parameters by feel.

## 9. Lazy hydration

### 9.1 Initial index

After vault unlock and conversation decrypt:

1. Build a title-only index for every loaded conversation.
2. Rebuild when the conversation list changes materially.
3. Re-apply cached recent-message text for conversations whose cache revision is still valid.

### 9.2 Query-time hydration

When the user enters a non-empty query:

1. Search the title-only / partially hydrated index immediately.
2. Pick conversations that are not hydrated yet, newest first.
3. Fetch page 1 of messages for those conversations (`page_size=100` max today).
4. Decrypt in the browser with that conversation's keypair.
5. Join recent non-deleted message content into `recentMessages`.
6. Rebuild or update the Orama document.
7. Re-run the current search and update results.

Hydration should be bounded:

- hydrate at most 10 conversations at a time;
- cap each `recentMessages` string to about 8 KB;
- skip conversations whose keypair is unavailable;
- stop scheduling new hydration when the query is cleared.

### 9.3 Idle hydration

Optional but useful after V1 is stable:

- On browser idle, hydrate the newest visible conversations first.
- Never block interaction for this.
- Do not hydrate on locked vault or after logout.

## 10. Cache and invalidation

V1 cache is in memory only.

Cache key:

```txt
conversation_id + ':' + (last_activity_at || updated)
```

Cache value:

```ts
{
  recentMessages: string;
  hydratedMessageIds: string[];
  hydratedAt: number;
}
```

Invalidate when:

- `last_activity_at` or `updated` changes;
- conversation title changes;
- a message is soft-deleted or hard-deleted in that conversation;
- the conversation is deleted;
- the vault locks;
- the user logs out or switches account.

Do **not** persist plaintext search text to localStorage or IndexedDB in V1. If persistent cache is
needed later, it must be encrypted with a key unavailable while the vault is locked and documented
as a separate security decision.

## 11. Security rules

- The server never receives plaintext for search indexing.
- The browser never logs queries, decrypted titles, decrypted messages, Orama documents, or
  snippets.
- Decryption failures produce an empty `recentMessages` field for that conversation; do not index
  “Failed to decrypt message”.
- Search must respect existing access. It can only index conversations already returned by the
  authorised conversation/project APIs.
- Clear the in-memory index and cache on vault lock/logout.
- Keep message content out of analytics events.

## 12. Implementation notes for later

Suggested frontend shape:

- Add `ConversationSearchIndexService`.
- It reads loaded conversations from `ConversationService` and `ProjectConversationService`.
- It owns:
    - Orama DB lifecycle;
    - query signal;
    - scored result ids;
    - hydration queue;
    - in-memory cache.
- It uses `CognosApiService.listConversationMessages()` directly.
- Extract message decryption into a small pure helper so search and `MessageService` share the same
  binding checks.

Avoid introducing a generic search abstraction until at least two search areas need BM25.

## 13. Test plan

Write tests before implementation.

### Unit tests

- Title match appears immediately.
- Recent-message-only match appears after hydration.
- Title hit outranks message-only hit for the same term.
- Query clearing cancels/suppresses pending hydration results.
- Cache is reused when `last_activity_at` is unchanged.
- Cache invalidates when `last_activity_at` changes.
- Deleted/tombstoned message content is not indexed.
- Decryption failure does not index the fallback error string.
- Search hydration does not mutate `MessageService.messages()` or selected conversation state.

### Browser e2e

- Searching by chat title still works.
- Searching by a word in a recent message finds the chat after JIT hydration.
- Clearing search restores Projects/Pinned/Recent navigation.
- A project chat can match search once project conversations are loaded.
- The on-device search hint is visible.

### API/security e2e

No new backend endpoint is expected. Existing conversation/message access tests remain the access
boundary. If a new endpoint is added later, update `docs/api-permissions.md` and add cross-user
denial tests first.

## 14. Related exploration: encrypted API response caching

Search hydration benefits from faster encrypted message reads, but HTTP/CDN caching is broader than
search and has its own security rules. Keep it separate from the Orama implementation.

See: [encrypted-api-response-caching](./encrypted-api-response-caching.md).

## 15. Open questions

- Should V2 show message snippets in results, or is chat-row-only better for privacy?
- Should persistent encrypted search cache be worth the extra security surface?
- Should older pages hydrate on demand when the first 100 messages do not find enough results?
- Is encrypted response caching useful enough after in-memory search hydration cache exists?
