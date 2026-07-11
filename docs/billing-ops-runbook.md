# Billing operations runbook

Practical guide for taking Cognos billing live on Paddle and operating it.
Behaviour reference is `docs/specs/billing.md`; the build status is in
`docs/billing-launch-plan.md`. This doc is the go-live checklist + the
"something looks wrong, what do I do" guide.

## Canonical customer prices

The production Paddle catalogue and every customer-facing surface must use these values:

| Plan              | Price                                 |
| ----------------- | ------------------------------------- |
| Pay as you go     | CHF 15 monthly minimum, plus overage  |
| Unlimited monthly | CHF 150 per month                     |
| Unlimited annual  | CHF 1'500 per year (two months free)  |

Prices exclude applicable tax/VAT, which Paddle calculates at checkout. Subscriptions renew for
the same billing period until cancelled. Cancellation stops the next renewal; access continues to
the end of the paid period. The advertised 60-day money-back guarantee is limited to one refund per
Account lifetime; follow the refund procedure in §4.

**Example PAYG invoice:** an Account uses CHF 22.40 of AI in a monthly cycle. Paddle has already
charged the CHF 15 minimum at renewal, so Cognos posts CHF 7.40 as overage for that closed cycle. If
usage is CHF 8.00, there is no overage and the charge remains CHF 15, plus applicable tax/VAT.

## 1. Production wiring checklist

### 1.1 Paddle dashboard (live account)

- Create the four prices (CHF, excl. tax) and copy their `pri_…` ids:
    - `cognos-payg` — recurring monthly, **CHF 15.00** (the minimum commit).
    - `cognos-payg-overage` — **one-time**, **CHF 0.01** unit (overage is billed
      as `quantity = overage in Rappen` of this price).
    - `cognos-unlimited-m` — recurring monthly, **CHF 150.00**.
    - `cognos-unlimited-y` — recurring annual, **CHF 1500.00** (two months free compared with
      monthly billing).
- Create a **notification destination** → `https://<prod-host>/webhooks/paddle`,
  and subscribe exactly these events:
    - `subscription.created`, `subscription.activated`, `subscription.updated`,
      `subscription.canceled`, `subscription.past_due`
    - `transaction.completed`
    - `adjustment.created`
- Copy the destination's **signing secret** (`pdl_ntfset_…`).
- Create a **server-side API key** (`pdl_live_…`).

### 1.2 Backend config (prod)

Config is koanf — set via `configs/api.production.yaml` or `COGNOS_*` env vars.
Secrets should come from files/secret-store, never committed.

| Setting                                   | Env var                                                | Notes                               |
| ----------------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| `paddle.api_base`                         | `COGNOS_PADDLE_API_BASE`                               | `https://api.paddle.com` (live)     |
| `paddle.api_key`                          | `COGNOS_PADDLE_API_KEY` / `COGNOS_PADDLE_API_KEY_FILE` | server key; never client            |
| `paddle.webhook_secret`                   | `COGNOS_PADDLE_WEBHOOK_SECRET` / `…_FILE`              | notification-destination secret     |
| `paddle.price_payg`                       | `COGNOS_PADDLE_PRICE_PAYG`                             | `pri_…`                             |
| `paddle.price_payg_overage`               | `COGNOS_PADDLE_PRICE_PAYG_OVERAGE`                     | `pri_…` (required for PAYG overage) |
| `paddle.price_unlimited_monthly`          | `COGNOS_PADDLE_PRICE_UNLIMITED_MONTHLY`                | `pri_…`                             |
| `paddle.price_unlimited_annual`           | `COGNOS_PADDLE_PRICE_UNLIMITED_ANNUAL`                 | `pri_…`                             |
| `billing.payg_min_commit_rappen`          | `COGNOS_BILLING_PAYG_MIN_COMMIT_RAPPEN`                | default `1500` (CHF 15)             |
| `billing.unlimited_fair_use_alert_rappen` | `COGNOS_BILLING_UNLIMITED_FAIR_USE_ALERT_RAPPEN`       | default `20000` (CHF 200)           |
| `billing.trial_seed_rappen`               | `COGNOS_BILLING_TRIAL_SEED_RAPPEN`                     | default `200` (CHF 2)               |

Without `paddle.api_key` the checkout/portal/cancel/change-plan routes return
`503`. Without `price_payg_overage` the PAYG overage is **not** posted (logged
instead) — set it.

### 1.3 Frontend

- Point `environment.pocketbaseBaseUrl` at the prod API host.
- Configure the Paddle.js **client-side token** for the overlay (separate from
  the server API key). Without it, checkout falls back to the hosted page.

### 1.4 Go-live smoke test

1. Send a Paddle test event to the destination → expect `200`, a row in
   `paddle_events` with `processed_at` set, `processing_error` empty.
2. Buy each plan with a sandbox/live test card → `subscription.created` flips the
   user's plan; `/account/billing` shows it.
3. Switch plans → exactly one subscription on the Paddle customer (no duplicate).

## 2. How billing behaves (operator view)

- **PAYG** bills `max(usage, CHF 15)` per cycle: Paddle charges the CHF 15
  commit up front each cycle; at cycle rollover (`subscription.updated`) we sum
  the closing cycle's ledger usage and, if it exceeds CHF 15, post a one-time
  overage charge (`overage_<cycle_id>` idempotency key) billed on the next
  renewal. Each closed cycle is a row in `payg_cycle_summaries`.
- **Unlimited** never bills per request; usage is recorded (`amount_rappen=0`,
  cost in `user_cost_rappen`) for fair-use only.
- **Dunning**: a failed renewal → `subscription.past_due` sets `user_billing.past_due`;
  the user keeps working (banner shows "update your card"). Recovery
  (`subscription.activated`) clears it; if Paddle gives up, `subscription.canceled`
  → `inactive`.
- **Refunds / chargebacks**: issue the refund in the Paddle dashboard (or via the
  adjustments API). The resulting `adjustment.created` writes a `refunds` row,
  sets `users.refund_used` (one per lifetime), and — for a chargeback — drops the
  user to `inactive`. The dashboard then shows the invoice as REFUNDED.
- **Fair-use**: a nightly job logs (WARN) any Unlimited account whose rolling
  30-day user-cost exceeds CHF 200. Monitor-only — it never throttles. Review the
  logs and reach out / discuss Enterprise per spec §8.1.

## 3. Triage — when something looks wrong

- **A webhook failed**: `paddle_events` rows have `processing_error` set and
  `processed_at` empty. The raw payload is in `payload_json` — inspect, fix the
  cause, and (if needed) re-send the event from the Paddle dashboard. Re-delivery
  is idempotent (deduped on `paddle_event_id`).
- **An overage charge didn't land**: a `payg_cycle_summaries` row with
  `overage_charge_rappen > 0` and an empty `paddle_overage_txn_id`. The 5-minute
  backstop retries automatically (look for "payg overage backstop" logs). The
  deterministic idempotency key means a retry never double-charges. Persistent
  failure → check the Paddle API key / overage price id.
- **Plan/Paddle out of sync**: `user_billing` is our snapshot; the Paddle
  dashboard is the source of truth for the subscription. A missed
  `subscription.updated` can be healed by re-sending it. Switching plans always
  modifies the one subscription — if a customer has duplicate active
  subscriptions, they pre-date the change-plan flow and should be cancelled in
  Paddle.
- **Reconciliation**: `payg_cycle_summaries.reconciled` is set when
  `transaction.completed` records a billed amount ≥ the local expected. See the
  open item below before treating a `reconciled=false` as drift.

## 4. Issuing a goodwill / out-of-window refund

There is no `cognos refund` CLI yet (spec §7.3 / §12.6 — future). For now:

1. Create the refund/adjustment in the **Paddle dashboard** against the relevant
   transaction (full or partial).
2. Paddle fires `adjustment.created` → we record a `refunds` row, set
   `users.refund_used`, and surface the REFUNDED badge. No balance change is
   needed (Paddle moved the money).
3. To also end the plan, cancel the subscription in Paddle (→ `subscription.canceled`
   → `inactive`).

The user-facing "Request a refund" button (in-window) only **logs** a request
for follow-up — it does not issue anything.

## 5. Known open item — overage charge timing (verify against live data)

The overage is posted with `effective_from: next_billing_period`, so it rides a
later renewal transaction. With "commit in advance + overage in arrears", a
single Paddle transaction can span two cycles' charges, so exact per-cycle
`reconciled` equality is **not** asserted yet — we record for audit and assert
only the safe lower bound (`billed ≥ expected`). After the first real PAYG cycle
with overage in production, confirm which transaction the overage lands on and
tighten the `reconciled` check + add a drift alert (`billing-launch-plan.md`
Phase 4 open item).
