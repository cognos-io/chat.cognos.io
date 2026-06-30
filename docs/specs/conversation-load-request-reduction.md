# Conversation Load — Request Reduction Spec

**Status:** Draft / exploration
**Scope:** Cut the request fan-out when the app loads the conversation list. This is about **how
many requests** the first load makes, not about caching repeat reads (see
[encrypted-api-response-caching](./encrypted-api-response-caching.md)).

## 0. Read this first

Loading the sidebar today can fire **300+ requests**, roughly half of them CORS `OPTIONS`
preflights. The fix order, by leverage:

1. **Embed conversation key material in the list response** so the client stops fetching keys
   per-conversation. Collapses ~`4N` requests to ~`1`.
2. **Serve the SPA same-origin with the API** so authenticated XHRs stop triggering preflights.
   Removes ~half the requests independently of (1).
3. **Cache immutable responses** for repeat loads — owned by the caching spec.
4. **Confirm HTTP/2** at the edge so the remaining requests multiplex.

Hard rule:

> Embedding keys must not widen access. The list returns only the **requesting user's** wrapped
> secret key, at the conversation's **current** `key_version`, and only ciphertext/wrapped material
> the same user could already fetch one-by-one.

## 1. The problem

The standalone conversation load is the fan-out source:

- `GET /api/v1/conversations` returns `conversationRecordResponse` — `data` only, **no keys**
  (`backend/internal/handler/conversations.go`).
- For **each** conversation `ConversationService.fetchConversationKeyPair` then calls
  `GET …/{id}/public-key` **and** `GET …/{id}/secret-key`.
- Cross-origin, each of those carries an `Authorization` header, so the browser preflights with
  `OPTIONS`.

Per conversation that is ~4 requests (2 GET + 2 preflight). 50 conversations ≈ 200 requests for keys
alone, before messages.

**Project conversations already avoid this.** `GET /api/v1/projects/{id}/conversations` embeds
`wrapped_conversation_secret_key` inline (`backend/internal/handler/project_conversations.go`), and
`ProjectConversationService.decrypt()` derives the keypair from it with **zero** extra requests. The
standalone path is the outlier; this spec brings it in line.

> Note: this is **not** caused by conversation search. Search hydration only fetches messages, only
> on an active query, capped at 10 conversations. First paint is unaffected.

## 2. Fix 1 — embed key material in the conversation list

### 2.1 Response shape

Extend `conversationRecordResponse` so each conversation carries everything the client needs to
decrypt without a follow-up request:

```jsonc
{
  "id": "…",
  "data": "…",                       // existing: encrypted conversation data
  "key_version": 1,                  // existing
  "last_activity_at": "…",           // existing
  // NEW — current-generation key material, scoped to the requester:
  "public_key": "…",
  "public_key_signature": "…",
  "wrapped_secret_key": "…"          // wrapped for THIS user only
}
```

This mirrors the project-conversation list, which already returns `public_key`,
`public_key_signature`, and `wrapped_conversation_secret_key` inline.

### 2.2 Backend

- Join `conversation_public_keys` and `conversation_secret_keys` when building the list.
- Filter both to the conversation's **current** `key_version` and the secret key to the
  **requesting user** — the exact predicate the `key-version-read-gate` business process already
  enforces on the standalone key endpoints (`ownedConversationSecretKeyRecord`,
  `ConversationPublicKey` sort by `-key_version LIMIT 1`). Reuse it; do not re-derive.
- Omit a conversation's key fields if its current-generation key material is missing rather than
  failing the whole list (the client falls back to the per-conversation endpoints for that one).

### 2.3 Frontend

- `fetchConversation` decrypts straight from the list payload: verify `public_key_signature`, unwrap
  `wrapped_secret_key` with the user shared key, decrypt `data` — no `getConversationPublicKey` /
  `getConversationSecretKey` calls on the happy path.
- Keep the per-conversation key endpoints for writes, rotation, and the missing-key fallback above.
- The decrypt path already exists for project conversations; share it where practical.

### 2.4 Keep the key endpoints

The two GET key endpoints are **not** removed. They remain for key creation/rotation, the
public-share/copy flows, and as the fallback when the list omits a conversation's keys. Only the
**bulk read on load** moves into the list response.

## 3. Fix 2 — same-origin serving (kill preflights)

Half the requests are `OPTIONS` only because the browser goes cross-origin with an auth header.

- PocketBase already serves the production SPA via `--publicDir` (the e2e stack runs this way). If
  prod is deployed same-origin, there are **zero** preflights.
- If prod splits app and API across hosts, reverse-proxy `/api` under the app origin so requests are
  same-origin.
- `Access-Control-Max-Age` is a weak fallback: it caches preflights per-URL, and conversation URLs
  are unique, so it barely helps. Same-origin is the real fix.

This is independent of Fix 1 — together they take conversation load from ~`4N`+preflights to ~`1`.

## 4. Fix 4 — HTTP/2 at the edge

300 requests on HTTP/1.1 is brutal (6-connection cap, head-of-line blocking). On HTTP/2 they
multiplex over one connection. Confirm the production reverse proxy serves h2/h3. This does not
reduce the count; Fixes 1 and 2 do that.

## 5. Relationship to caching

Fix 1 reduces the **first** load; caching reduces **repeat** loads. They compose:

- With keys embedded, the conversation list response now contains key material, so the caching
  spec's list ETag/validator must hash the embedded keys too (rotation already bumps `key_version`,
  which is in the response and the validator).
- With keys in the list, the standalone key endpoints largely leave the hot load path, so the
  caching spec's "do not cache key endpoints in phase 0" caveat stops mattering for load cost.

See [encrypted-api-response-caching](./encrypted-api-response-caching.md) for the ETag/TTL/purge
design.

## 6. Security rules

- The list returns only the requesting user's wrapped secret key — never another participant's.
- Only the **current** `key_version` key material is embedded; stale generations stay invisible, per
  `key-version-read-gate`.
- No plaintext: the embedded fields are the same ciphertext/wrapped material the per-conversation
  endpoints already return to this user.
- Embedding must not change authorisation: the list already returns only conversations the user can
  access; joining keys adds no new rows.

## 7. Test plan

Write tests before implementation. This change touches the auth surface, so per
`docs/api-permissions.md`: authorize, register in the auth-surface guardrail, add a cross-user
denial test.

- The list embeds `public_key`, `public_key_signature`, and the requesting user's
  `wrapped_secret_key` for each accessible conversation.
- A second user's wrapped secret key never appears in the first user's list (cross-user denial).
- Only current-generation key material is embedded; after rotation the list carries the new
  generation, not the old.
- A conversation missing current-generation key material omits its key fields rather than failing
  the list.
- Frontend: loading N conversations issues **one** list request and **zero** per-conversation
  `public-key`/`secret-key` requests on the happy path.
- Frontend: a conversation whose list entry omits keys still resolves via the fallback endpoints.
- Decryption, signature verification, and binding behaviour are unchanged versus the per-endpoint
  path.

## 8. Open questions

- Should the per-conversation key GET endpoints eventually be deprecated for reads once the list
  path is proven, or kept indefinitely as the fallback?
- Is prod currently same-origin (PocketBase `--publicDir`) or split-host? That decides whether Fix 2
  is already done.
- Does the edge serve HTTP/2/3 today?
