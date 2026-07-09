---
description: Every completion is preflighted against the caller's billing plan — inactive blocks, trial requires affordability, payg/unlimited pass through
name: billing-access-gate
---

# Billing Access Gate

Before the gateway is called, `billing.Service.EvaluateAccess(state, estimate)`
decides whether the Account holder is allowed to spend on this request. The
**estimate** is the upper-bound cost for the Model (full input context ×
`max_output_tokens`, with margin and FX applied).

| `plan_type` | Decision                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------- |
| `inactive`  | **Block** — `402 INACTIVE`, message `"Choose a plan to keep chatting."`                     |
| `trial`     | **Block if** `balance_rappen < estimate_rappen` — `402 TRIAL_EXHAUSTED` with balance + cost |
| `payg`      | Pass — usage will be metered post-paid via Paddle (see [billing spec](../specs/billing.md)) |
| `unlimited` | Pass — flat-rate plan, no per-request gating                                                |

```mermaid
flowchart LR
  C[/complete request/] --> E[EstimateUpperBoundCost]
  E --> S[Load billing state]
  S --> P{plan_type?}
  P -- inactive --> X1[402 INACTIVE]
  P -- trial --> A{balance ≥ estimate?}
  A -- no --> X2[402 TRIAL_EXHAUSTED]
  A -- yes --> OK
  P -- payg --> OK
  P -- unlimited --> OK
  OK[gateway call]
```

Why the upper bound, not a point estimate: the gate runs before the actual
Provider call, so the only safe budgeting unit is "the maximum this request
could possibly cost." Anything looser risks letting a trial Account run
slightly negative.

The actual cost (post-gateway) is recorded by the
[usage-ledger](./usage-ledger.md) step and may be smaller than the estimate
— the difference is not refunded, it stays in the Account's balance.
