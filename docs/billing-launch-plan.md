# Billing launch-completion plan (working doc)

> **Temporary working checklist** — delete once everything here is shipped. Source of truth
> for behaviour is `docs/specs/billing.md`; this doc is the ordered plan to close the gaps
> between what's built and what's needed to launch **PAYG + Unlimited** complete, including
> abuse detection.

## Context — what's already done

Trial gating + locked-chat; sidebar plan/profile; Paddle schema + webhook
(`subscription.created/activated/canceled`, HMAC-verified, idempotent); Paddle.js overlay
checkout + hosted fallback + email prefill + activation poll; the 4-state Plan & billing
dashboard; customer portal; live card (brand/last4/expiry); real invoices list; plan-aware
usage (CHF spend for PAYG); cancel/resume; settings shell + `/account`; the vault security
fixes. All with unit + e2e coverage.

## What's left (this plan)

Ordered by dependency and launch-criticality. Each phase ships as its own small PR/commit set
following the repo discipline: **e2e red→green first, unit tests for hot paths (sunny/rainy/
edge), keep `docs/specs/billing.md` updated, run build+lint+test.**

Backend collections already exist (no new migrations unless noted): `balance_transactions`
(`user_cost_rappen`, `provider_cost_rappen`, `occurred_at`, `model_id`, `type`,
`input_tokens`, `output_tokens`), `user_billing` (`paddle_subscription_id`,
`paddle_cycle_start_at/end_at`, `paddle_price_id`, `plan_type`, `plan_ends_at`), and the
currently-unused `payg_cycle_summaries` and `refunds`.

---

### Phase 0 — Webhook event coverage (foundation for 1, 3, 4, 5) — ✅ `subscription.updated` done

Today only `subscription.created/activated/canceled` do anything; `subscription.past_due` and
`transaction.completed` are no-ops, and `subscription.updated` / `adjustment.created` aren't
handled at all. Everything below hangs off these.

1. ✅ Add a `subscription.updated` case → handler `updateSubscription`:
   - ✅ Refresh `user_billing` snapshot (price, cycle window, `plan_ends_at`/scheduled change).
   - ✅ Detect **cycle rollover** (new `current_billing_period.starts_at` vs stored
     `paddle_cycle_start_at`) → for PAYG, close the previous cycle via an idempotent
     `closePAYGCycle` (writes a `payg_cycle_summaries` row with local usage + expected bill +
     overage). Posting the overage **charge** to Paddle is Phase 1.
   - ✅ Detect **price/plan change** → update `paddle_price_id` + `plan_type`.
2. `transaction.completed` case → handler `recordTransaction` — deferred to **Phase 4** (event is
   already stored raw; the meaningful body is reconciliation).
3. `adjustment.created` case → handler `recordAdjustment` — deferred to **Phase 5** (event is
   already stored raw; the body is refund recording).
4. ✅ Keep every branch idempotent (re-delivery safe) — events are de-duped on `paddle_event_id`;
   the cycle close is additionally keyed on a deterministic id per `(subscription_id, cycle_end)`.

- **Files:** `backend/internal/handler/paddle_webhook.go`, `internal/billing/payg.go` (cycle math),
  `internal/config/api.go` + `cmd/api/{routes,main}.go` (`BILLING_PAYG_MIN_COMMIT_RAPPEN` wiring).
- **Tests:** `internal/billing/payg_test.go` (overage math); `cmd/api/paddle_webhook_test.go`
  (rollover writes a summary, idempotent re-delivery, scheduled-cancel surfaces `plan_ends_at`).

---

### Phase 1 — 🔴 PAYG cycle-end overage charge + reconciliation (spec §11) — LAUNCH-BLOCKING

Without this, PAYG only ever bills the CHF 10 floor and never charges usage above it.

1. **Paddle client:**
   `CreateOneTimeCharge(ctx, subscriptionID, priceID, quantityRappen, idempotencyKey)` →
   `POST /subscriptions/{id}/charge` with `items:[{price_id, quantity}]` (overage price is the
   1-Rappen unit; quantity = overage Rappen). Confirm exact request/`effective_from` shape against
   Paddle docs. Pass a deterministic `Paddle-Idempotency-Key`.
2. **Cycle close** (triggered by Phase 0 rollover, or a small reconcile pass):
   - Sum `user_cost_rappen` from `balance_transactions` for the closing cycle window
     (`paddle_cycle_start_at`..`paddle_cycle_end_at`, `type='usage'`).
   - `overage = max(0, usage − 1000)` Rappen.
   - Write a `payg_cycle_summaries` row (`local_usage_rappen`, `overage_charge_rappen`,
     `local_expected_bill_rappen = max(usage,1000)`, cycle window). The row's deterministic id / a
     unique key per `(subscription_id, cycle_end_at)` IS the idempotency guard.
   - If `overage > 0`, post the one-time charge; store `paddle_overage_txn_id`.
3. **Reliability (spec §11.3):** idempotency key per cycle so retries/re-delivery never

   double-charge; on Paddle failure, leave the summary `reconciled=false` for the Phase 4 sweep to
   retry.

- **Files:** `internal/paddle/client.go` (+ fake), `internal/billing/` (cycle usage sum + close
  logic — likely a new `payg.go`), `internal/handler/paddle_webhook.go`, route wiring if a
  manual/cron trigger is added.
- **Tests:** unit — overage math (usage<10, =10, >10, no usage); idempotency (second close is a
  no-op); client httptest for the charge call. Integration — rollover event closes the cycle and
  posts the right amount.
- **Acceptance:** a PAYG cycle with CHF 23.40 usage posts a CHF 13.40 overage charge exactly once; a
  cycle ≤ CHF 10 posts nothing; re-delivered rollover doesn't double-charge.

---

### Phase 2 — 🔴 Plan switching updates the existing subscription (no duplicates)

"Switch plan" currently routes to `/pricing` → a fresh checkout → a **second** subscription.

1. **Paddle client:** `ChangeSubscriptionPrice(ctx, subscriptionID, newPriceID, prorationMode)` →
   `PATCH /subscriptions/{id}` with the new item + `proration_billing_mode`.
2. **Backend:** `POST /api/v1/billing/change-plan {plan}` → if the user has an active
   `paddle_subscription_id`, change its price; else fall back to checkout (new customer). Map
   plan→price as today.
3. **Frontend:** "Switch plan" calls change-plan when a subscription exists (not a new overlay).

   Show a confirm with proration wording; refresh on success. Keep the overlay only for first
   purchase / resubscribe-after-inactive.

- **Files:** `internal/paddle/client.go` (+fake), new `internal/handler/billing_change_plan.go`,
  `cmd/api/routes.go`, `frontend/.../billing.service.ts`, `plan-billing.component.*`,
  `cognos-api.service.ts`.
- **Tests:** e2e — active user "Switch plan" hits change-plan, not checkout; a brand-new user still
  gets the overlay. Integration — change-plan with an existing sub calls Paddle update; without one
  returns checkout. Unit — the routing decision.
- **Acceptance:** switching PAYG↔Unlimited (and monthly↔annual) modifies the one subscription; the
  user is never left with two.

---

### Phase 3 — 🟠 Failed payment / dunning → past_due surface

`subscription.past_due` is ignored, so we show "active" while Paddle has suspended.

1. **Webhook:** `subscription.past_due` → mark a grace state on `user_billing` (reuse `plan_type` +
   a `past_due` flag, or a status field); `subscription.canceled` after dunning already → inactive.
2. **API:** surface the past_due state in `GET /api/v1/billing` (`status: 'past_due'`).
3. **Frontend:** a "Payment failed — update your card to keep your plan" banner on the dashboard +

   the chat shell, linking to the portal payment deep-link. Decide whether sending is blocked during
   grace (recommend: keep working through the grace window, then the canceled event locks it).

- **Files:** webhook, `internal/handler/billing.go` (status), `billing.service.ts` + a banner
  component, `plan-billing.component`.
- **Tests:** integration — past_due event flips status; e2e — banner shows for past_due and links to
  the portal.
- **Acceptance:** a failed renewal shows the dunning banner; recovery (next
  `subscription.activated`) clears it.

---

### Phase 4 — 🟠 Transaction recording + periodic reconciliation

1. **Webhook `transaction.completed`** → record the cycle invoice against the matching
   `payg_cycle_summaries` row (`paddle_billed_rappen`, `paddle_transaction_id`, `closed_at`), set
   `reconciled=true` when local-expected ≈ paddle-billed.
2. **Reconciliation pass** (cron or PocketBase scheduled job): find `payg_cycle_summaries` with

   `reconciled=false` or open cycles past their end; retry a missed overage charge; flag drift
   (local-expected vs paddle-billed) for triage. Also self-heals missed webhooks.

- **Files:** webhook, a new `cmd/` cron entry or PocketBase `Cron` hook, `internal/billing/payg.go`.
- **Tests:** unit — reconcile marks matching rows reconciled, flags mismatches, retries unposted
  overage; integration — `transaction.completed` closes the summary.
- **Acceptance:** every closed PAYG cycle ends `reconciled=true`; a deliberately-dropped webhook is
  recovered by the next pass.

---

### Phase 5 — 🟠 Refunds (adjustment.created) + REFUNDED invoice status

1. **Webhook `adjustment.created`** → write a `refunds` row (`gross_refund_rappen`,
   `net_refund_rappen`, `paddle_adjustment_ids_json`, `inside_guarantee_window` from
   `refund_eligible_until_at`); set `users.refund_used` where relevant (spec §7).
2. **Invoices:** the dashboard "REFUNDED" badge — Paddle transaction status has no `refunded`;
   derive it from a linked adjustment (the invoices endpoint cross-references `refunds`/adjustments
   for the transaction). Map → red/neutral lozenge.
3. **Refund request endpoint** `POST /api/v1/billing/refund-request` (spec §12.5) — initially

   stubbed/operator-driven; full self-serve later.

- **Files:** webhook, `internal/handler/billing_invoices.go` (+ adjustment lookup),
  `internal/paddle/webhook.go` (parse adjustment), frontend badge mapping.
- **Tests:** integration — adjustment event writes a refund row; invoices endpoint returns
  `status: refunded` for the affected transaction; e2e — REFUNDED badge renders.

---

### Phase 6 — 🟡 Invoice polish

1. **Per-invoice PDF download:** `GET /api/v1/billing/invoices/{id}/pdf` → verify the transaction's
   `customer_id` matches the caller's customer **before** calling Paddle
   `GET /transactions/{id}/invoice`; return the URL; frontend opens it in a new tab (download icon
   per row).
2. **Line descriptions:** parse `items[].price.name` (+ `billing_cycle.interval`) in `ListInvoices`

   → e.g. "Unlimited · monthly"; fall back to "Invoice {number}".

- **Files:** `internal/paddle/client.go`, `billing_invoices.go`, new PDF handler + route +
  auth-surface test, `plan-billing.component.*`.
- **Tests:** integration — PDF endpoint 200 for own invoice, 403/404 for another customer's id; e2e
  — invoice rows show the plan description + a working download icon.

---

### Phase 7 — ⚪ Fair-use / abuse monitoring (Unlimited) — spec §8, §14.11

1. **Usage aggregation:** a DuckDB (per CLAUDE.md tooling) rollup over `balance_transactions`
   computing per-user token/cost totals per window; flag users exceeding fair-use thresholds (e.g. >
   Nx the median, or an absolute token ceiling).
2. **Soft action:** spending-alert / soft-limit mechanism (spec §14.11) — notify + optionally
   throttle flagged accounts; operator review before any hard action.
3. **Surface:** an internal report / dashboard for review (not customer-facing initially).

- **Files:** a new `cmd/fairuse/` (or `internal/billing/fairuse`) job + DuckDB query; alerting hook.
- **Tests:** unit — threshold/flagging logic over seeded usage (normal vs outlier); the job is
  read-only (never hard-limits without a flag).
- **Acceptance:** a synthetic heavy Unlimited account is flagged; normal accounts aren't.

---

### Phase 8 — ⚪ Production webhook wiring + ops

1. Production Paddle **notification destination** → `https://<prod-host>/webhooks/paddle`, with the
   signing secret in `COGNOS_PADDLE_WEBHOOK_SECRET` (file/secret, not committed). Subscribe:
   `subscription.created/activated/updated/canceled/past_due`, `transaction.completed`,
   `adjustment.created`.
2. Production Paddle **client token** + price IDs + `paddle.api_base` (live host) in prod config.
3. A short **runbook**: how overage/reconciliation/dunning behave, what to check when a webhook

   fails, how to issue a goodwill refund.

- **Acceptance:** a sandbox→prod checklist is green; a test event reaches prod and is processed.

---

### Out of billing scope (track separately)

The remaining settings pages (Account / Usage / Security & keys / Team & sharing /
Notifications) are placeholders — not billing, and not gating launch. List here only so they
aren't forgotten.

## Suggested order

0 → **1 → 2** (launch-blocking) → **3 → 4** (correctness) → **5** → **8** (go-live prerequisite)
→ 6 → 7. Phases 0–5 + 8 are the real "complete billing" launch set; 6–7 can trail shortly after
if needed, but 7 (abuse) should land before heavy Unlimited usage.
