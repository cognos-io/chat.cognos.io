# Encrypted API Response Caching — Exploration Spec

**Status:** Draft / exploration  
**Scope:** HTTP caching for API responses that contain encrypted conversation and message blobs.
This is not a plaintext search index and not a decrypted data cache.

## 0. Read this first

Caching ciphertext can still leak or preserve sensitive **metadata**.

V1 recommendation:

1. Fix backend message pagination first.
2. Add browser-cache validators (`ETag` / `304`) first.
3. Treat CDN caching as phase-gated.
4. If CDN caching is enabled, start with **single-participant** conversation reads only.
5. Use Bunny.net tag purge via `CDN-Tag` where possible.
6. Keep 24 hours as an upper-bound TTL for stable encrypted message pages, not a blanket default.

Hard rule:

> No decrypted chat content, query text, snippets, or search-index documents may be cached outside
> the active browser process.

## 1. Why explore this

Search hydration and chat navigation can fetch the same encrypted blobs repeatedly:

- conversation list ciphertext;
- project conversation list ciphertext;
- paginated message ciphertext.

The browser still has to decrypt locally, but HTTP caching can avoid reloading unchanged ciphertext
from PocketBase/API.

> Caching reduces **repeat** loads. The **first** load's request fan-out (per-conversation key
> fetches) is a separate, higher-leverage fix — see
> [conversation-load-request-reduction](./conversation-load-request-reduction.md). Once that spec
> embeds key material in the conversation list, the list response carries the keys too, so the list
> ETag/validator (§13) must hash that material; rotation already bumps `key_version`, which is in
> both the response and the validator.

## 2. Candidate responses

Explore only encrypted read responses:

- `GET /api/v1/conversations`
- `GET /api/v1/projects/{projectID}/conversations`
- `GET /api/v1/conversations/{conversationID}/messages?page=...&page_size=...`

Do **not** include in phase 0:

- user keypair endpoints;
- conversation secret/public key endpoints;
- redaction key endpoints;
- memory/compaction endpoints until their deletion/invalidation rules are proven;
- public-share endpoints.

## 3. Backend pagination gap

Current message pagination is a blocker for broad search hydration and cache efficiency.

`ConversationMessagesList` currently:

1. authorises the conversation;
2. counts message rows;
3. loads **all** message records for the conversation;
4. sorts in Go;
5. slices the requested page.

That means “fetch page 1 for 10 chats” can still load full histories for 10 chats on the first miss.
Caching reduces repeat load, but does not fix first-read cost.

### 3.1 Improvement options

#### Option A — DB-level offset pagination

Use the database/PocketBase query layer to filter by `conversation`, sort by newest first, and apply
`LIMIT/OFFSET` before rows reach Go.

Requirements:

- index for `(conversation, created)` or equivalent;
- keep response shape unchanged;
- keep `totalItems` / `totalPages` if the UI still needs them.

Pros: smallest change.  
Cons: offset pages shift when new messages arrive; deep offsets can still be expensive.

#### Option B — cursor pagination

Return messages after/before a cursor such as `(created, id)`.

Pros:

- stable pages;
- better for long histories;
- better cache keys for old pages.

Cons:

- frontend pagination state changes;
- response shape changes;
- more test work.

#### Option C — recent-message endpoint

Add a dedicated read endpoint for search hydration, e.g. “latest 100 encrypted messages for these
conversation IDs”.

Pros: fastest for search.  
Cons: new auth surface; more API/docs/tests; risks duplicating message-list semantics.

#### Recommendation

- Phase 0: implement **Option A** before JIT search hydration or response caching.
- Phase 1: move to **Option B** if long histories/search hydration still hurt.
- Avoid Option C unless search needs batch hydration after Options A/B.

## 4. Browser cache path

Browser caching is lower risk than CDN caching because the cache is local to the user agent.

Investigate:

- `ETag` / `If-None-Match`;
- `Cache-Control: private`;
- short `max-age` plus validators;
- Angular `HttpClient` behaviour with the current auth transport;
- cache clearing on logout/vault lock where the browser permits it.

Recommended headers for phase 0 browser-only caching:

```txt
Cache-Control: private, max-age=60, must-revalidate
ETag: "..."
```

Browser cache is an optimisation only. The in-memory decrypted search cache still clears on vault
lock/logout.

## 5. CDN cache path

CDN caching is higher risk because a shared edge cache can serve a response without re-checking
origin auth.

Ciphertext does not remove these leaks:

- conversation IDs;
- message counts and page sizes;
- activity ordering;
- ciphertext sizes;
- access/no-access to a resource;
- stale deleted rows until purge/expiry.

### 5.1 Phase gates

Phase 0 CDN caching should exclude:

- multi-participant standalone conversations;
- project conversations;
- any endpoint whose access can be revoked by another user;
- key-material endpoints;
- public-share endpoints.

Phase 0 may cache only single-participant conversation/message reads if all of these are true:

- cache key is scoped to the authenticated principal;
- purge works in tests;
- destructive mutations purge synchronously;
- TTLs are endpoint-specific;
- there is a fast kill switch to disable CDN caching.

## 6. Bunny.net notes

Bunny.net matters because its cache model shapes the interface.

From Bunny docs checked during this exploration:

- default cache key is the request URL;
- **Vary Cache** can vary by selected cookies and request headers;
- custom header-based vary may require Bunny support/internal configuration;
- origin responses can be tagged with `CDN-Tag`;
- tag purge uses `POST https://api.bunny.net/pullzone/{id}/purgeCache` with body
  `{ "CacheTag": "..." }`;
- Bunny also has a Purge URL endpoint (`POST /purge`) and supports exact URL and prefix/wildcard
  purges;
- prefix/wildcard purges have lower rate limits than exact purges;
- `CDN-Tag` values are limited to 1024 bytes;
- tag-based purging is not supported with Perma-Cache enabled.

Recommendation for Bunny:

- Prefer `CDN-Tag` + tag purge over URL wildcard purge.
- Do not enable Perma-Cache for these API responses.
- Use URL purge only as a fallback for exact response URLs or emergency cleanup.

## 7. Cache key / principal scoping options

### Option A — vary on the auth cookie

Configure Bunny Vary Cache to include the auth cookie.

Pros: simple; hard to forge.  
Cons: low hit rate across sessions; easy to misconfigure; cache entries may include cookie-derived
identity in CDN internals/logs.

### Option B — dedicated opaque cache namespace cookie

Set a separate cookie, for example `cog_cache_ns`, whose value is an HMAC/opaque namespace:

```txt
HMAC(cache_secret, user_id + ':' + auth_generation + ':' + access_generation)
```

Configure Bunny Vary Cache on that cookie.

Pros: no raw user ID in the cache key; namespace can rotate.  
Cons: still needs purge; stale clients can still present an old namespace until expiry.

### Option C — request header namespace

Send `X-Cognos-Cache-Namespace: <opaque namespace>` and configure Bunny Vary Cache on that header.

Pros: avoids cookie coupling; explicit.  
Cons: if the browser can forge it, it must be unguessable; Bunny custom header vary may need support
configuration.

### Option D — resource generation in URL/query

Add a non-secret generation/hash query parameter to cacheable GETs, e.g.
`?cache_gen=<opaque generation>`.

Pros: new frontend requests naturally bypass old cache after mutation.  
Cons: stale clients can still request old URLs; does not replace purge; URL churn can reduce hit
rate.

### Recommendation

> **Confirmed transport:** the app authenticates with `Authorization: Bearer <token>` (PocketBase
> default `LocalAuthStore`, token in localStorage) — there is **no auth cookie**. So Option A
> (vary on auth cookie) is out, and Option B's namespace must be a **request header**, not a
> cookie. Prefer Option C (`X-Cognos-Cache-Namespace`) or, simplest for phase 0, do not CDN-cache
> authenticated API responses at all: cache only static SPA assets at the edge and rely on browser
> `ETag`/`304` for the API. Revisit header-vary only once same-origin hosting (`app.cognos.io/api`)
> lands and the namespace can be set safely.

For Bunny phase 0:

1. Use a dedicated opaque `cog_cache_ns` **request header** (not a cookie — see above).
2. Configure Bunny Vary Cache on that one value, not the full `Authorization` header.
3. Include a server-side access/cache generation in the namespace where practical.
4. Still purge on mutation. Namespace rotation is defence-in-depth, not a replacement for purge.

## 8. Cache tags / key prefixes

Use logical key prefixes/tags so one mutation can purge every affected object.

Suggested prefixes:

```txt
user:{principalHash}:conversations
project:{projectID}:conversations:user:{principalHash}
conversation:{conversationID}:messages:user:{principalHash}
conversation:{conversationID}:messages:page:{page}:size:{pageSize}:user:{principalHash}
```

Use `principalHash`, not raw user ID, if tags can appear in CDN logs.

For Bunny, emit these as `CDN-Tag` values on responses. Purging
`conversation:{conversationID}:messages:user:{principalHash}` should remove all cached message pages
for that user's view of the conversation.

## 9. Purge interface

Backend code should depend on one small interface:

```go
type EncryptedResponseCachePurger interface {
    Purge(ctx context.Context, keyPrefixes []string) error
}
```

Notes:

- `keyPrefixes` are logical cache tags/prefixes, not decrypted data and not raw URLs.
- Passing multiple prefixes lets one mutation purge conversation lists and message pages together.
- The Bunny implementation maps each prefix to a `CDN-Tag` purge.
- Local/dev uses a no-op implementation.
- If a future CDN only supports URL prefix purge, its implementation can expand key prefixes to URL
  prefixes internally.
- Keep batch semantics inside the implementation so handlers do not know CDN details.

## 10. Purge triggers

Purge affected encrypted response objects when any of these happen:

- conversation created, renamed, deleted, duplicated, or activity changes;
- message created, soft-deleted, hard-deleted, edited/forked, regenerated, or image-generated;
- participant added/removed or role changed;
- project member added/removed or role changed;
- project conversation created/deleted;
- conversation key rotation;
- account deletion or delete-all-chats;
- expiry cleanup deletes messages.

Conservative purge is acceptable. Prefer purging too much over serving stale access-sensitive
metadata.

## 11. Purge failure policy

Be stricter for access and deletion changes than for normal cache freshness.

### Low-risk mutations

Examples: new message, title update, normal activity bump.

- Commit the mutation.
- Purge synchronously or via a reliable outbox.
- Alert on purge failure.
- If purge backlog grows, disable CDN caching with the kill switch.

### High-risk mutations

Examples: participant removal, project member removal, conversation delete, account delete,
delete-all-chats, key rotation.

Recommended policy:

- Do not CDN-cache these resources in phase 0 if they can be affected by another user.
- If CDN caching is later enabled, require synchronous purge success before reporting success.
- If purge fails, fail closed where possible and mark the cache feature unhealthy.
- If the data mutation has already committed, return/alert as a critical incident and disable CDN
  caching until purge catches up.

Hash/generation identifiers help current clients avoid old cache entries after changes, but they do
not protect stale or removed clients that can still request an old cached URL. Purge is still
required.

## 12. TTL recommendations

Use endpoint-specific TTLs. 24 hours is an upper bound, not a blanket default.

| Endpoint / page type                   | Browser cache                           | CDN cache phase 0 recommendation                       |
| -------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| Conversation list                      | `private, max-age=60, must-revalidate`  | avoid or `s-maxage=300` with purge                     |
| Project conversation list              | `private, max-age=60, must-revalidate`  | avoid in phase 0                                       |
| Message page 1, offset pagination      | `private, max-age=60, must-revalidate`  | avoid; page shifts when new messages arrive            |
| Older message pages, offset pagination | `private, max-age=300, must-revalidate` | avoid until cursor pagination                          |
| Cursor-stable encrypted message pages  | `private, max-age=300`                  | `s-maxage=86400` with tags + purge                     |
| Single-participant latest message page | `private, max-age=60`                   | optional `s-maxage=300` until cursor pagination exists |

Recommendation:

- Do not use 24h CDN TTL until message pages are stable enough that new messages do not shift page
  contents.
- Use 24h only for cursor-stable or otherwise generation-addressed encrypted pages.
- Use shorter TTLs for lists because they reveal membership/activity metadata.

## 13. ETag / validator recommendations

Validators must be generated centrally so handlers and cache purgers agree on what changed.

### 13.1 Reliable option

After building the authorised response body, compute:

```txt
ETag = base64url(SHA-256(endpoint_version || principal_namespace || canonical_response_json))
```

Pros: correct whenever response bytes change.  
Cons: still builds the response before returning `304`, so it saves bandwidth more than CPU/DB.

### 13.2 Faster option

Build validators from metadata:

- conversation list: principal namespace + ordered conversation IDs + each record `updated` /
  `last_activity_at` + participant/project access generation;
- project conversation list: project ID + principal namespace + project membership generation +
  ordered conversation IDs + record activity timestamps;
- message page: conversation ID + principal namespace + page/cursor + message IDs + message row
  `updated`/`expires` + total count/version.

Pros: can skip response body work if metadata is cheap.  
Cons: easy to miss an invalidation input.

### 13.3 Interface shape

Centralise cache descriptors:

```go
type CacheDescriptor struct {
    ETag         string
    CacheControl string
    CDNTags      []string
}

type EncryptedResponseCachePolicy interface {
    ConversationList(ctx context.Context, principal Principal, records []ConversationRecord) CacheDescriptor
    ProjectConversationList(ctx context.Context, principal Principal, projectID string, records []ConversationRecord) CacheDescriptor
    MessagePage(ctx context.Context, principal Principal, conversationID string, page PageDescriptor, records []MessageRecord) CacheDescriptor
}
```

Handlers should ask this policy for headers. Mutation code should use the same tag/key builder when
purging.

Start with the reliable body-hash ETag. Move to metadata validators only after tests prove every
mutation changes the validator.

## 14. Required tests before enabling CDN cache

- Cross-user denial still holds when a response is warm in cache.
- Removed participant cannot receive a cached conversation/message response.
- Removed project member cannot receive cached project conversation responses.
- Deleted conversation/message does not reappear from cache.
- Account delete and delete-all-chats do not leave readable cached responses.
- Key rotation does not serve stale generations where that breaks access expectations.
- Purge failure on high-risk mutations fails closed or disables CDN caching.
- Browser reload can reuse `304 Not Modified` without persisting plaintext search text.
- Bunny Vary Cache is configured for the exact namespace cookie/header used in tests.
- Bunny tag purge removes every cached page tagged by the key prefix.

## 15. Open questions

- Does Bunny custom request-header vary need support configuration for our account, or should phase
  0 use a cookie vary?
- Do we need a cache-purge outbox table for retries and alerting?
- Which endpoints, if any, are safe enough for CDN phase 0 beyond single-participant message pages?
- Should conversation/message cache generations become first-class plaintext metadata, or should we
  avoid adding more metadata and rely on response-body ETags?
