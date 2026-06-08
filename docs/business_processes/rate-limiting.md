---
description: All /api/v1/* routes go through an in-process token-bucket limiter keyed on user ID (or IP, if unauthenticated)
name: rate-limiting
---

# Rate Limiting

Every `/api/v1/*` route is bound to `rateLimiterMiddleware`. Defaults:

- **600 requests per hour** sustained
- **Burst of 60** to absorb the parallel `/api/v1/*` GETs that fire on
  first paint of the SPA
- Limiter entries **expire after 30 min** of inactivity to keep memory bounded
- **Disabled in dev** (`app.IsDev()` short-circuits to `e.Next()`)

Identifier resolution:

```mermaid
flowchart LR
  R[request] --> U{auth.ExtractUser?}
  U -- yes --> ID[identifier = user.id]
  U -- no --> IP[identifier = e.RealIP]
  ID --> L[lookup/create *rate.Limiter]
  IP --> L
  L --> A{Allow?}
  A -- yes --> N[next handler]
  A -- no --> R429[429 Too Many Requests]
```

Why user-id-first: shared NAT'd networks (offices, coworking spaces)
would otherwise share a bucket and rate-limit each other.

Authentication-flow limits are configured separately via Pocketbase's
built-in `Settings().RateLimits` (`hooks.ApplyRateLimits`) — see
[`backend/internal/hooks/rate_limits.go`]. Those caps are stricter
(e.g. 3 password resets per 5 min) because auth surfaces are abuse magnets.
