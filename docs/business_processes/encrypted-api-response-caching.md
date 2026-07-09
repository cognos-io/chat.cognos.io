---
description: Encrypted API responses may be browser/CDN cached only with principal-scoped keys, short TTLs, and explicit purge
name: encrypted-api-response-caching
---

# Encrypted API Response Caching

Caching encrypted blobs can reduce repeat API reads, but ciphertext is **not harmless**.
It still carries metadata: row access, counts, ordering, timestamps and blob sizes.

Phase order:

1. Fix backend message pagination so page 1 does not load whole histories.
2. Add browser `ETag` / `304` caching first.
3. Only then consider Bunny.net CDN caching.

## Rules

- Never cache decrypted content, search queries, snippets, or search index documents outside the
  active browser process.
- Do not CDN-cache key-material endpoints.
- Do not CDN-cache multi-participant or project conversation reads in phase 0.
- Cache keys must be scoped to an opaque principal namespace, not just URL.
- Use endpoint-specific TTLs; 24h is only an upper bound for stable encrypted message pages.
- Bunny CDN responses should use `CDN-Tag`; purges should call Bunny tag purge, not full-zone purge.

## Purge interface

Backend code should depend on:

```go
type EncryptedResponseCachePurger interface {
    Purge(ctx context.Context, keyPrefixes []string) error
}
```

A mutation can pass several prefixes, e.g. conversation-list and message-page tags. Local/dev uses a
no-op purger. Bunny maps each prefix to a `CDN-Tag` purge.

## Strict cases

For Participant removal, project Participant removal, deletes, delete-all-chats, Account deletion
and Conversation key rotation: either prove purge succeeds or do not CDN-cache the affected
resources.

If purge is missed, stale ciphertext can be served until TTL expiry.

See the full spec: [encrypted-api-response-caching](../specs/encrypted-api-response-caching.md).
