---
description: A user can only use models whose privacy tier they meet — ch_only ≤ eu ≤ global
name: privacy-tier-gating
---

# Privacy Tier Gating

Each model in the catalogue carries a `PrivacyTier`:

| Tier        | Rank | Meaning                                                |
| ----------- | ---- | ------------------------------------------------------ |
| `ch_only`   | 0    | Hosted in Switzerland, no data retention               |
| `eu`        | 1    | Hosted in the EU                                       |
| `global`    | 2    | Anywhere (default — most permissive)                   |

A user has a `privacy_tier` field on their `users` record. The rule:

```text
allowed iff rank(modelTier) <= rank(userTier)
```

For a `ch_only` user only `ch_only` models are eligible. For an `eu` user
`ch_only` and `eu` models are eligible. For a `global` user everything active
is eligible. Unknown / missing user tier values normalise to `eu`.

The check is enforced in **two places**:

1. **`GET /api/v1/models`** returns every active model annotated with an
   `is_eligible` flag (plus an `ineligibility_reason` when false). Ineligible
   models are still listed but shown disabled in the picker, so users can see
   what a higher tier would unlock rather than wondering why a model is missing.
2. **`POST /…/complete`** re-checks the chosen model against the user's tier
   and returns `403 Model is not available for the user's privacy tier`
   if they smuggled in an ineligible model ID.

```mermaid
flowchart LR
  M[Model.PrivacyTier] -->|rank| R1
  U[User.privacy_tier] -->|rank| R2
  R1 --> C{R1 ≤ R2?}
  R2 --> C
  C -- yes --> A[allow]
  C -- no --> D[disabled in /models<br/>403 from /complete]
```

Why two places: the `is_eligible` flag drives UX (disabled in the picker),
the handler check is the authoritative gate. Both must agree.
