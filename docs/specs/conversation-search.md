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
- Stem with the **user's selected UI language**; one stemmer per index, rebuilt on locale change.
- Do not implement embeddings or semantic search here.

This spec's design decisions are settled. See [§16 Resolved decisions](#16-resolved-decisions) for
the log; the remaining genuine unknowns live in [§15 Open questions](#15-open-questions).

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
  recentMessages: string;  // joined decrypted message `content`; empty until hydrated
  updatedMs: number;       // for tie-breaks outside Orama
  projectId?: string;
}
```

### 7.1 What feeds `recentMessages`

The decrypted message (`MessageData` in `frontend/src/app/interfaces/message.ts`) carries
`content`, an optional `reasoning`, a role, and a tombstone flag. The indexing rule is precise:

- Index the decrypted `content` only, for both user and assistant messages.
- **Exclude `reasoning`** — it is not user-authored and is a non-goal (§5).
- **Exclude tombstoned/soft-deleted messages** — their `content` is `null` once cleared, so they
  drop out naturally; never index the role/timestamp scaffold that remains.
- Join the surviving `content` strings newest-first, capped per §9.2.

So one document indexes exactly: the conversation **title** + the concatenated message **content**.

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
  threshold: 0, // require ALL query terms — see note below
  tolerance: 1, // typo / light-inflection recall safety net
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
- **`threshold: 0`** returns only documents that contain **all** the query terms. In Orama,
  `threshold` is the _fraction of partial matches to include_: `1` (the default) returns any chat
  sharing one common token, `0` requires every term. A multi-word query like "lease clause" should
  surface chats containing both words, so `0` matches the intended behaviour. (An earlier draft used
  `0.6`, which is permissive — the opposite of the stated goal.)
- **`tolerance: 1`** allows one edit-distance typo per token. It is the recall safety net for
  stemming gaps (e.g. `lease`/`leases`) and for content whose language differs from the active
  stemmer (§8.1). Raise it only with tests — higher tolerance adds false positives and cost.

Tune only with tests. Do not tweak BM25 parameters by feel.

### 8.1 Tokenization and language (i18n)

The decrypted corpus is multilingual (en/de/fr/es/pt/it). Orama uses **one stemmer per index**, so
we bind the index language to the user's **active Transloco UI locale**:

- On index build, **lazy-import the active locale's stemmer** from `@orama/stemmers` via a dynamic
  `import()` and pass it through the tokenizer component with `stemming: true`. Only one stemmer is
  ever loaded, so the bundle stays small.
- Orama applies the same tokenizer to documents **and** the query, so stemming stays consistent for
  free.
- **Rebuild the index on locale change.** This reuses the same rebuild hook as a material
  conversation-list change (§9.1). Locale switches are rare.
- All six supported locales exist in Orama's stemmer set, so there is no unsupported-language
  branch.
- Assumption: a user mostly writes in their UI language. When content language ≠ UI language the
  stemmer is suboptimal, but `tolerance: 1` keeps recall acceptable rather than dropping hits.
- **Out of scope:** CJK and other non-space-delimited scripts. The min-query-length rule (§9) and
  default tokenizer assume Latin-script, space-delimited text.

## 9. Lazy hydration

### 9.0 Query gating

Before any search or hydration runs, the raw input is gated:

- **Minimum 3 characters** (trimmed). Shorter input shows the normal Projects/Pinned/Recent
  navigation and triggers no hydration.
- **Debounce 400 ms**, then `distinctUntilChanged`, so hydration never fires per keystroke.
- Clearing the query takes an immediate reset path — the user should not wait 400 ms to get their
  navigation back.

See §12 for how this maps onto the RxJS pipeline.

### 9.1 Initial index

After vault unlock and conversation decrypt:

1. Build a title-only index for every loaded conversation.
2. Rebuild when the conversation list changes materially.
3. Re-apply cached recent-message text for conversations whose cache revision is still valid.

### 9.2 Query-time hydration

When a gated query (§9.0) arrives:

1. Search the title-only / partially hydrated index immediately.
2. **Eagerly load project conversations** if they are not already in the store. Project chats are
   normally fetched lazily as projects expand; on the first search of a session we fetch them up
   front so search covers them. This is acceptable because users search infrequently.
3. Pick conversations that are not hydrated yet, newest first.
4. Fetch page 1 of messages for those conversations. Page 1 is the newest 100 messages — the backend
   sorts by `created` descending and caps `page_size` at 100
   (`backend/internal/handler/conversations.go`).
5. Decrypt in the browser with that conversation's keypair (run the existing binding checks).
6. Join surviving message `content` (per §7.1) into `recentMessages`.
7. Update the Orama document (remove + insert).
8. Re-run the current search and update results.

Hydration should be bounded:

- hydrate at most 10 conversations at a time;
- cap each `recentMessages` string to about 8 KB;
- skip conversations whose keypair is unavailable;
- stop scheduling new hydration when the query changes or clears — `switchMap` cancels in-flight
  message fetches (§12), so superseded queries waste no network or decrypt work.

### 9.3 Idle hydration

Optional but useful after V1 is stable:

- On browser idle, hydrate the newest visible conversations first.
- Never block interaction for this.
- Do not hydrate on locked vault or after logout.

## 10. Cache and invalidation

V1 cache is in memory only. **The Orama DB itself is the cache** — hydrated `recentMessages` text
lives in the index and persists across queries (a query cancelled by `switchMap` keeps whatever it
already inserted). A side `Map<conversationId, revision>` records the key below so we can detect
staleness; there is no separate text store.

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
- conversation title changes — this updates the document's `title` field only; it does **not**
  invalidate hydrated `recentMessages`, since the message text is unaffected by a title edit;
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

## 12. Search service architecture

### 12.1 It replaces the current filter

Today: `ChatComponent.onSearchChange()` → `ConversationService.filter$` (a `Subject<string>`) →
`filteredConversations` (a `title.includes()` computed) → `orderedConversations` → sidebar template.

V1 introduces `ConversationSearchIndexService` as the **owner of the query and results**, replacing
the substring `filter$` path. The sidebar binds its input to this service and renders the flat
"Search results" list (§6.2) from it when the query is active; the empty-query path keeps rendering
the existing Projects/Pinned/Recent groups. Standardise on Orama here — but do **not** build a
generic search abstraction until a second area needs BM25.

`ConversationSearchIndexService` reads loaded conversations from `ConversationService` and
`ProjectConversationService` and owns:

- Orama DB lifecycle (build, locale-driven rebuild, teardown on lock/logout);
- the query signal/subject;
- scored result ids;
- the bounded hydration queue;
- the in-memory cache + revision map (§10).

It calls `CognosApiService.listConversationMessages()` directly (never `MessageService`, to avoid
mutating active-chat state). Extract message decryption into a small pure helper so search and
`MessageService` share the same `assertMessageBindings()` checks.

### 12.2 Race-safe pipeline (RxJS `switchMap`)

`CognosApiService` returns Observables, so cancellation is idiomatic. The query flows through:

```txt
query$ (Subject<string>)
  → debounceTime(400)
  → map(trim) → distinctUntilChanged()
  → branch:
       length < 3  → reset to Projects/Pinned/Recent, no hydration
       otherwise   → switchMap(query => hydrateAndSearch$(query))
  → toSignal → searchResults
```

`switchMap` is the core race protection: a new query tears down the previous query's inner stream,
which **cancels its in-flight `listConversationMessages` HTTP requests** — not merely discards their
results. A manual generation counter would still waste the network and decrypt work. Inside
`hydrateAndSearch$(query)`:

1. emit the synchronous Orama search over the current index immediately;
2. eagerly load project conversations on first search (§9.2);
3. pick un-hydrated candidates newest-first (cap 10), fetch → decrypt → `remove+insert`;
4. re-run the search and emit after each batch (incremental result updates).

Because every conversation insert is atomic, a mid-flight `switchMap` cancellation never corrupts a
half-written document; it only stops scheduling further inserts. Inserts already made stay cached
(§10).

## 13. Test plan

Write tests before implementation.

### Unit tests

- Title match appears immediately.
- Recent-message-only match appears after hydration.
- Title hit outranks message-only hit for the same term.
- A multi-word query requires **all** terms (`threshold: 0`): a chat containing only one of two
  query words does not match.
- `tolerance: 1` recovers a single-character typo / simple inflection.
- Query clearing cancels/suppresses pending hydration results.
- A query change mid-hydration (`switchMap`) does not emit the superseded query's results.
- A query under 3 characters triggers no hydration and shows normal navigation.
- Cache is reused when `last_activity_at` is unchanged.
- Cache invalidates when `last_activity_at` changes.
- A title change updates the title field without invalidating hydrated `recentMessages`.
- Deleted/tombstoned message content is not indexed.
- Reasoning text is not indexed.
- Decryption failure does not index the fallback error string.
- Locale-based stemming: an inflected query matches inflected content in the active UI locale; the
  index rebuilds when the locale changes.
- Search hydration does not mutate `MessageService.messages()` or selected conversation state.

### Browser e2e

- Searching by chat title still works.
- Searching by a word in a recent message finds the chat after JIT hydration.
- Typing fewer than 3 characters shows normal navigation and runs no search.
- Clearing search restores Projects/Pinned/Recent navigation.
- A project chat matches search even before its project is expanded (eager project load on first
  search).
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

These are genuine V2+ unknowns, deliberately out of V1 scope:

- Should V2 show message snippets in results, or is chat-row-only better for privacy?
- Should a persistent encrypted search cache be worth the extra security surface?
- Should older pages hydrate on demand when the first 100 messages do not find enough results?
- Is encrypted response caching useful enough after the in-memory search hydration cache exists?
- Should we detect content language per conversation (vs. trusting the UI locale) if real usage
  shows frequent language mismatches?

## 16. Resolved decisions

Settled during spec review — recorded so they are not relitigated:

| #                | Decision                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library          | Stay on Orama v3 (sync API). No alternative search library — none handles a mixed-language corpus better, and Orama keeps the door open for the V2 semantic/hybrid path.                                  |
| Stemming         | One stemmer per index, bound to the **active Transloco UI locale**; lazy-import that stemmer from `@orama/stemmers`; rebuild on locale change. `tolerance: 1` as the recall safety net. CJK out of scope. |
| Threshold        | `threshold: 0` (require all query terms). The earlier `0.6` was permissive and contradicted the stated goal.                                                                                              |
| Indexed fields   | Conversation **title** + message **content** only. Exclude reasoning, tombstoned messages, attachments.                                                                                                   |
| Pipeline         | `ConversationSearchIndexService` **replaces** `ConversationService.filter$`; standardise on Orama. No generic search abstraction until a second area needs BM25.                                          |
| Race control     | RxJS `switchMap` (cancels in-flight fetches), `debounceTime(400)`, `distinctUntilChanged`, **min 3 chars**.                                                                                               |
| Project coverage | **Eagerly load** project conversations on the first search of a session.                                                                                                                                  |
| Cache            | The Orama DB **is** the in-memory cache; a side revision map drives invalidation. A title change updates the title field without dropping hydrated message text.                                          |
