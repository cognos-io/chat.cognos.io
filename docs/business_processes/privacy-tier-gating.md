---
description: Each Account can only use Models whose privacy tier they meet — ch_only ≤ eu ≤ global
name: privacy-tier-gating
---

# Privacy Tier Gating

Each model in the catalogue carries a `PrivacyTier`:

| Tier        | Rank | Meaning                                                |
| ----------- | ---- | ------------------------------------------------------ |
| `ch_only`   | 0    | Hosted in Switzerland, no data retention               |
| `eu`        | 1    | Hosted in the EU                                       |
| `global`    | 2    | Anywhere (default — most permissive)                   |

Each Account has a `privacy_tier` field on their `users` record. The rule:

```text
allowed iff rank(modelTier) <= rank(userTier)
```

An Account at the `ch_only` privacy tier may only use `ch_only` Models. An Account at
the `eu` privacy tier may use `ch_only` and `eu` Models. An Account at the `global`
privacy tier may use any active Model. Unknown / missing Account privacy tier values
normalise to `eu`.

The check is enforced in **two places**:

1. **`GET /api/v1/models`** returns every active Model annotated with an
   `is_eligible` flag (plus an `ineligibility_reason` when false). Ineligible
   Models are still listed but shown disabled in the picker, so Account holders
   can see what a higher privacy tier would unlock rather than wondering why a
   Model is missing.
2. **`POST /…/complete`** re-checks the chosen Model against the Account's privacy
   tier and returns `403 Model is not available for the Account's privacy tier`
   if an ineligible model ID was requested.

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
