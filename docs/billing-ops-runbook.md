# Billing operations runbook

Practical guide for taking Cognos billing live on Paddle and operating it.
Current behaviour is defined by the [billing business processes](./business_processes/README.md).
Unresolved billing work is centralised in [open points](./open-points.md#operations-and-billing).
This doc is the go-live checklist and the “something looks wrong, what do I do?” guide.

## Canonical customer prices

The production Paddle catalogue and every customer-facing surface must use these values:

| Plan              | Price                                                           |
| ----------------- | --------------------------------------------------------------- |
| Pay as you go     | CHF 15 monthly minimum, plus overage                            |
| Unlimited monthly | CHF 150 per month                                               |
| Unlimited annual  | CHF 1'500 per year (two months free)                            |
| Organisation Seat | CHF 15 per Seat per month (minimum 3 Seats, CHF 45/month floor) |

Prices exclude applicable tax/VAT, which Paddle calculates at checkout. Subscriptions renew for
the same billing period until cancelled. Cancellation stops the next renewal; access continues to
the end of the paid period. The published Refund Policy (cognos.io/refund) offers an unconditional
14-day full-refund window, matching Paddle's own refund policy (a Paddle payment-verification
requirement — do not reintroduce case-by-case wording). Grant requests inside the window without
argument; refuse only where Paddle flags fraud or refund abuse. A refund cancels the plan it paid
for. Follow the refund procedure in §4.

**Example PAYG invoice:** an Account uses CHF 22.40 of AI in a monthly cycle. Paddle has already
charged the CHF 15 minimum at renewal, so Cognos posts CHF 7.40 as overage for that closed cycle. If
usage is CHF 8.00, there is no overage and the charge remains CHF 15, plus applicable tax/VAT.

## 1. Production wiring checklist

### 1.1 Paddle dashboard (live account)

- Create the five prices (CHF, excl. tax) and copy their `pri_…` ids:
    - `cognos-payg` — recurring monthly, **CHF 15.00** (the minimum commit).
    - `cognos-payg-overage` — **one-time**, **CHF 0.01** unit (overage is billed
      as `quantity = overage in Rappen` of this price).
    - `cognos-unlimited-m` — recurring monthly, **CHF 150.00**.
    - `cognos-unlimited-y` — recurring annual, **CHF 1500.00** (two months free compared with
      monthly billing).
    - `cognos-org-seat` — recurring monthly, **CHF 15.00 per Seat**. Allow the quantity range
      required by the product (at least **3–100**); Cognos sends
      `max(active Memberships, 3)` as the checkout and sync quantity.
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

| Setting                                   | Env var                                                | Notes                                |
| ----------------------------------------- | ------------------------------------------------------ | ------------------------------------ |
| `paddle.api_base`                         | `COGNOS_PADDLE_API_BASE`                               | `https://api.paddle.com` (live)      |
| `paddle.api_key`                          | `COGNOS_PADDLE_API_KEY` / `COGNOS_PADDLE_API_KEY_FILE` | server key; never client             |
| `paddle.webhook_secret`                   | `COGNOS_PADDLE_WEBHOOK_SECRET` / `…_FILE`              | notification-destination secret      |
| `paddle.price_payg`                       | `COGNOS_PADDLE_PRICE_PAYG`                             | `pri_…`                              |
| `paddle.price_payg_overage`               | `COGNOS_PADDLE_PRICE_PAYG_OVERAGE`                     | `pri_…` (required for PAYG overage)  |
| `paddle.price_unlimited_monthly`          | `COGNOS_PADDLE_PRICE_UNLIMITED_MONTHLY`                | `pri_…`                              |
| `paddle.price_unlimited_annual`           | `COGNOS_PADDLE_PRICE_UNLIMITED_ANNUAL`                 | `pri_…`                              |
| `paddle.price_org_seat`                   | `COGNOS_PADDLE_PRICE_ORG_SEAT`                         | `pri_…` (required for Organisations) |
| `billing.payg_min_commit_rappen`          | `COGNOS_BILLING_PAYG_MIN_COMMIT_RAPPEN`                | default `1500` (CHF 15)              |
| `billing.unlimited_fair_use_alert_rappen` | `COGNOS_BILLING_UNLIMITED_FAIR_USE_ALERT_RAPPEN`       | default `20000` (CHF 200)            |
| `billing.trial_seed_rappen`               | `COGNOS_BILLING_TRIAL_SEED_RAPPEN`                     | default `200` (CHF 2)                |

Without `paddle.api_key` the checkout/portal/cancel/change-plan routes return
`503`. Without `price_payg_overage` the PAYG overage is **not** posted (logged
instead) — set it. Organisation checkout also returns `503 Billing is not configured` when either
the API key or `price_org_seat` is empty. If personal checkout works but Organisation checkout does
not, `price_org_seat` is the missing setting.

The API base, API key, prices, frontend client token, and webhook destination must all belong to
the same Paddle environment. Sandbox price IDs do not exist in live Paddle, and live price IDs do
not exist in the sandbox.

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
4. Create an Organisation, add its payment method, and confirm that checkout contains **quantity
   3** (the three-Seat minimum) for a new Organisation with one Owner. Complete it and verify
   `org_billing` has the Organisation id, Paddle customer and subscription ids, `plan_type=payg`,
   and `seat_quantity = 3`.

## 2. How billing behaves (operator view)

- **PAYG** bills `max(usage, CHF 15)` per cycle: Paddle charges the CHF 15
  commit up front each cycle; at cycle rollover (`subscription.updated`) we sum
  the closing cycle's ledger usage and, if it exceeds CHF 15, post a one-time
  overage charge (`overage_<cycle_id>` idempotency key) billed on the next
  renewal. Each closed cycle is a row in `payg_cycle_summaries`. When cycle
  usage reaches the minimum, Accounts see a one-per-cycle soft warning on Plan
  & billing (ack stamps `payg_soft_alert_cycle_start_at`); Completions are
  never blocked by this alert. A hard spend breaker remains deferred (OP-037).
- **Unlimited** never bills per request; usage is recorded (`amount_rappen=0`,
  cost in `user_cost_rappen`) for fair-use only.
- **Organisation** bills `max(N × CHF 15, pooled usage)` per cycle where
  `N = max(active Seats, 3)` — minimum **CHF 45/month** even for a solo Owner.
  Paddle charges `N × CHF 15` at renewal; at cycle rollover we sum org-attributed
  ledger usage and, if it exceeds the pooled floor, post one overage charge
  (`org_cycle_summaries`, same CHF 0.01-unit mechanism as personal PAYG).
  Seat adds prorate when quantity rises above the current count; Seat removes
  schedule `pending_seat_quantity = max(remaining members, 3)` at the next cycle
  — never below three Seats, no mid-cycle refund.
- **Dunning**: a failed renewal → `subscription.past_due` sets `user_billing.past_due`;
  the user keeps working (banner shows "update your card"). Recovery
  (`subscription.activated`) clears it; if Paddle gives up, `subscription.canceled`
  → `inactive`.
- **Refunds / chargebacks**: issue the refund in the Paddle dashboard (or via the
  adjustments API). The resulting `adjustment.created` writes a `refunds` row,
  sets `users.refund_used` (one per lifetime), and — for a chargeback — drops the
  user to `inactive`. The dashboard then shows the invoice as REFUNDED.
- **Commercial risk**: a nightly job reports rolling Provider-cost percentiles by Account and Model,
  and PAYG ledger contribution margin by Model. It warns when one Model reaches CHF 50 Provider COGS
  in 30 days or an Unlimited Account reaches CHF 200 Account-facing cost. CHF 450 escalates to an
  immediate shutdown review. Alerts never silently change access.

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
- **Organisation checkout says “Billing is not configured”**: check that the backend has both a
  Paddle API key and `paddle.price_org_seat` / `COGNOS_PADDLE_PRICE_ORG_SEAT`. Create the recurring
  CHF 15 monthly per-Seat price in the matching sandbox or live catalogue, copy its `pri_…` id,
  restart the API, then retry. A client-side token does not replace the server API key or price id.
- **Reconciliation**: `payg_cycle_summaries.reconciled` is set when
  `transaction.completed` records a billed amount ≥ the local expected. See the
  open item below before treating a `reconciled=false` as drift.

## 4. Issuing a goodwill / out-of-window refund

There is no `cognos refund` CLI. For now:

1. Create the refund/adjustment in the **Paddle dashboard** against the relevant
   transaction (full or partial).
2. Paddle fires `adjustment.created` → we record a `refunds` row, set
   `users.refund_used`, and surface the REFUNDED badge. No balance change is
   needed (Paddle moved the money).
3. To also end the plan, cancel the subscription in Paddle (→ `subscription.canceled`
   → `inactive`).

The user-facing "Request a refund" button (in-window) only **logs** a request
for follow-up — it does not issue anything.

## 5. Overage reconciliation

The overage is posted with `effective_from: next_billing_period`, so it rides a
later renewal transaction. With "commit in advance + overage in arrears", a
single Paddle transaction can span two cycles' charges, so exact per-cycle
`reconciled` equality is **not** asserted yet — we record for audit and assert
only the safe lower bound (`billed ≥ expected`). After the first real PAYG cycle
with overage in production, confirm which transaction the overage lands on and
tighten the `reconciled` check and add a drift alert; see
[OP-012](./open-points.md#operations-and-billing).

## 6. Organisation dissolution reconciliation

The current dissolution request first schedules the Paddle subscription to cancel at the next
billing period, then deletes Organisation Projects and revokes Memberships in one PocketBase
transaction. A Paddle failure leaves Cognos unchanged and retryable. The inverse window remains:
Paddle may accept the cancellation, then the local transaction may fail.

Do not try to make a remote API call and a database transaction atomic. Replace the synchronous
sequence with a persisted, retryable state machine:

1. In one local transaction, create a unique dissolution operation for the Organisation with
   status `requested`, record the subscription id and explicit Project-deletion confirmation, and
   make Organisation content read-only.
2. A worker reads `requested` operations and asks Paddle to schedule cancellation. Paddle does not
   support arbitrary idempotency keys, so after timeouts or errors it must fetch the subscription
   and treat either `status=canceled` or `scheduled_change.action=cancel` as success before
   retrying.
3. Persist `paddle_confirmed`, then run the existing Project deletion, Membership revocation,
   `dissolved_at`, and audit writes in one PocketBase transaction.
4. Mark the operation `completed`. Retry `requested`, `paddle_confirmed`, and `local_failed`
   operations with bounded backoff; alert when an operation is not complete after 15 minutes.
5. Let `subscription.updated` (scheduled cancellation) and `subscription.canceled` webhooks wake
   the reconciler. They must not delete an Organisation unless a matching local dissolution intent
   exists.

Until that state machine lands, an operator investigating a failed dissolution must compare the
local Organisation state with Paddle's subscription `status` and `scheduled_change`. Never create a
second subscription. If Paddle shows a scheduled cancellation while Cognos is still active, retain
the Organisation data and escalate for a controlled local completion rather than deleting records
manually.

## 7. Model gross margin and cost percentiles

The nightly `cost-risk` logs are an early warning, not the final accounts. They report:

- Provider COGS by Model over the rolling 30-day window;
- p50, p90, p95 and p99 Provider COGS per Account, overall and for each Model;
- PAYG ledger revenue, gross profit and contribution-margin basis points by Model.

PAYG ledger revenue includes the 22% markup but excludes the CHF 15 minimum, Paddle fees, refunds,
tax and FX settlement differences. Trial cost is not revenue. Unlimited `user_cost` is a shadow
price and is never counted as revenue. A 22% markup on COGS is an 18.03% contribution margin before
those other effects.

For the monthly commercial review, export Paddle's net-of-tax settled revenue, fees, refunds and
chargebacks and join it to the content-free ledger period:

```text
net revenue = settled Paddle revenue - refunds - chargebacks - Paddle fees
gross profit = net revenue - Provider COGS
gross margin = gross profit / net revenue
```

Allocate PAYG minimum revenue and Unlimited subscription revenue to Models in proportion to each
Account's `user_cost_microrappen`. Report gross margin by Model and Plan, plus Account-level p50,
p90, p95 and p99 Provider COGS. Keep Account identifiers in the restricted billing system; the
review record contains aggregates only.

Initial beta alerts:

| Signal                         | Threshold                                              | Response                                                          |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------- |
| Model rolling Provider COGS    | CHF 50 / 30 days                                       | Check price sync, routing and margin by Plan                      |
| Actual Model gross margin      | Below 15% for two reviews with at least CHF 50 revenue | Stop promoting that Model; adjust price/routing                   |
| Actual Model gross margin      | Below 5% or negative for one review                    | Disable for new paid use pending owner approval                   |
| Account rolling Unlimited cost | CHF 200 / 30 days                                      | Start the fair-use review below                                   |
| Account rolling Unlimited cost | CHF 450 / 30 days                                      | Immediate shutdown review; decision required the same working day |

These are initial beta kill switches, not public Plan limits. Re-baseline them after four weeks of
real cost data; never raise a threshold merely to silence an alert.

## 8. Fair-use response procedure

1. Confirm the ledger rows are real, idempotent and use current Provider prices and FX. Do not read
   Message content.
2. Check for a compromised Account, automated traffic, retry loop, image-generation burst or model
   routing error. Treat credible compromise or billing-integrity failure as an incident.
3. At CHF 200–449.99 rolling cost, contact the Account holder, explain that usage is outside the
   expected human conversational pattern, and offer PAYG or a separately priced agreement. Record a
   response deadline of one working week.
4. At CHF 450 or for clear automation/compromise, make an immediate documented decision to continue,
   limit or pause new Completions. Do not delete history or prevent export. Give notice unless doing
   so would prolong an active security or billing incident.
5. Record the signal, evidence, decision, owner, notice and review date without prompts, Message
   content, filenames or other customer data.

Only an operator may suspend access for fair use. Automated alerts do not make contractual or fraud
decisions.

## 9. Refund-abuse controls

Before issuing a discretionary refund:

1. Verify the Paddle transaction belongs to the authenticated Account and is inside the advertised
   window. Check the lifetime `refund_used` flag and prior adjustments/chargebacks.
2. Compare settled revenue, Provider COGS and usage percentiles. Do not inspect Message content.
3. Require owner approval when Provider COGS is at least CHF 15, usage is above the Plan's p95,
   there is a prior chargeback, or linked payment evidence suggests repeated refund use.
4. Escalate for a deny/partial-refund decision when Provider COGS equals or exceeds the refundable
   amount, there is clear automation or fraud, or the lifetime discretionary refund was already
   used. Record
   the terms/legal basis; mandatory consumer rights always override this internal policy.
5. Issue the adjustment in Paddle, verify the idempotent webhook result, set `refund_used`, and
   cancel the Subscription if service should end. Never promise that clicking “Request a refund”
   issues it automatically.

Pause refund processing—not customer data access—if adjustment webhooks, transaction identity or
Paddle totals cannot be reconciled. Resume only after the billing owner signs off.

## 10. System shutdown thresholds

Pause new paid Completions globally and open an incident when any of these is true:

- Provider cost cannot be measured reliably and catalogue fallback prices cannot be confirmed;
- Paddle/ledger reconciliation differs by more than 5% or CHF 5, whichever is greater, across a
  closed cycle and the difference is unexplained;
- duplicate charges, cross-Account billing, leaked billing credentials or non-idempotent webhooks
  are credible;
- daily Provider COGS exceeds CHF 300 without matching paid activity; or
- a Provider price/routing change would make a currently promoted Model loss-making.

Model-only failures disable that Model first. Account-only fair-use signals follow §8. Preserve
read/export access and use the incident runbook for communication and recovery.

## 11. First real PAYG overage-cycle gate

Broad paid promotion remains blocked until one real, low-value PAYG cycle with usage above CHF 15
passes the record in
[`operations/payg-overage-validation.md`](operations/payg-overage-validation.md). Use a
company-owned synthetic Account and retain Paddle evidence outside this repository.
