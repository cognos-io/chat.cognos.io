---
description: Provider USD cost → +20% margin → CHF → integer rappen, with the FX rate snapshotted at request time
name: usage-cost-calculation
---

# Usage Cost Calculation

Every completion's user-facing cost runs through one canonical pipeline,
implemented in `billing.Service.CalculateCost`:

```text
1. provider_cost_usd = gateway.usage.provider_cost_usd   (if reported)
                     ∨ catalogue.pricing × tokens         (fallback)
2. user_cost_usd     = provider_cost_usd × (1 + MARGIN)   ; MARGIN = 0.20
3. fx_rate           = FXRateProvider.USDToCHF()          ; cached 24h
4. user_cost_chf     = user_cost_usd × fx_rate
5. user_cost_rappen  = round(user_cost_chf × 100)         ; INTEGER, never float
```

```mermaid
flowchart LR
  G[Gateway usage] -->|provider_cost_usd or tokens × catalogue| P[provider_cost_usd]
  P -->|× 1.20| U[user_cost_usd]
  FX[FX cache 24h] --> M[user_cost_chf = user × fx]
  U --> M
  M --> R[user_cost_rappen = round(chf × 100)]
```

Why USD-first markup, then FX (and not the other way around): the 20%
margin is a markup on **cost of goods sold**, which we incur in USD.
Compounding the margin in USD keeps it a stable percentage of provider
invoices regardless of how the CHF/USD pair moves. The math commutes
(`a × 1.2 × b == a × b × 1.2`), so the ordering is an audit choice, not a
numeric one.

Storage rules:

- All ledger balances and transaction amounts are **integer rappen**. No
  floats touch the balance.
- USD values are kept as `DOUBLE` for analytics only.
- The FX rate used for a transaction is stored on the transaction row, so
  every figure on the ledger can be independently re-derived without
  hitting the live FX cache.

FX cache:
[`billing.CachedFXRateProvider`](../../backend/internal/billing/fx_rate.go)
wraps a fallback constant (or, in the future, a live ECB/SNB feed) with a
24-hour TTL. Non-positive upstream values fall back to
`DefaultFXRateFallbackUSDCHF = 0.88` so a misconfigured upstream never
multiplies the bill by zero.
