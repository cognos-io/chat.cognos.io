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

### Phase 1 — ✅ PAYG cycle-end overage charge (spec §11) — LAUNCH-BLOCKING

Without this, PAYG only ever bills the CHF 15 floor and never charges usage above it.

1. ✅ **Paddle client:**
   `CreateOneTimeCharge(ctx, subscriptionID, priceID, quantity, idempotencyKey)` →
   `POST /subscriptions/{id}/charge?include=next_transaction` with
   `{effective_from:"next_billing_period", items:[{price_id, quantity}]}` (overage price is the
   1-Rappen unit; quantity = overage Rappen). Sends `Paddle-Idempotency-Key`. Confirmed against
   Paddle docs: the endpoint returns the **subscription** entity (201), not a transaction, so the
   overage rides the next renewal — no transaction id is available at post time.
2. ✅ **Cycle close** (triggered by the Phase 0 rollover in `closePAYGCycle`):
   - Sums `user_cost_rappen` over the closing cycle window (`type='usage'`).
   - Computes `overage = max(0, usage − commit)` via `billing.ComputeCycleSummary`.
   - Writes the `payg_cycle_summaries` row (deterministic id per `(subscription_id, cycle_end)` =
     idempotency guard).
   - If `overage > 0`, posts the one-time charge and stores `paddle_overage_txn_id` — or a
     `posted:<idempotency_key>` marker when Paddle returns no id yet, so the backstop won't re-post.
3. ✅ **Reliability (spec §11.3):** idempotency key `overage_<cycle_id>` per cycle. A Paddle failure
   is logged and leaves the summary `reconciled=false` + empty txn id (webhook still 200, cycle
   still advances) for the Phase 4 sweep to retry. **The 5-minute backstop itself is Phase 4.**

- **Files:** `internal/paddle/client.go` (+ fake), `internal/billing/payg.go`,
  `internal/handler/paddle_webhook.go`, `internal/config/api.go` + `cmd/api/{routes,main}.go`.
- **Tests:** unit — overage math (Phase 0); client httptest for the charge call (success, bad
  quantity, Paddle error). Integration — rollover with overage posts the right amount once; within
  the commit posts nothing; a charge failure still advances the cycle.
- **Acceptance:** ✅ a PAYG cycle with CHF 23.40 usage posts a CHF 8.40 overage charge exactly
  once; ✅ a cycle ≤ CHF 15 posts nothing; ✅ re-delivered rollover doesn't double-charge.

---

### Phase 2 — ✅ Plan switching updates the existing subscription (no duplicates)

"Switch plan" previously routed to `/pricing` → a fresh checkout → a **second** subscription.

1. ✅ **Paddle client:** `ChangeSubscriptionPrice(ctx, subscriptionID, newPriceID, prorationMode)` →
   `PATCH /subscriptions/{id}` with the new item + `proration_billing_mode`.
2. ✅ **Backend:** `POST /api/v1/billing/change-plan {plan}` → with an active
   `paddle_subscription_id`, changes its price; else falls back to checkout. **Proration policy
   (decided + live-verified):** upgrades (PAYG→Unlimited) `prorated_immediately`; downgrades +
   monthly↔annual `do_not_bill` (no charge today, no pro-rata credit). **Live Paddle caught that
   `full_next_billing_period` is rejected for billing-cycle changes (monthly↔annual) with
   `subscription_new_items_not_valid` — only `prorated_immediately`/`full_immediately`/`do_not_bill`
   are allowed there**, so the downgrade/lateral mode is `do_not_bill`. Paddle applies the swap
   immediately either way (it can't defer the price swap, only the billing). Switching away from
   PAYG closes the open cycle and posts the final overage via the deterministic-id close (no
   double-charge). Verified live: switching the test sub monthly↔annual modifies the one
   subscription (customer count stayed 4 — no duplicate).
3. ✅ **Frontend:** "Switch plan" opens a `cog-modal` (`SwitchPlanModalComponent`) with a
   monthly/yearly billing-period toggle that re-prices Unlimited, marks the plan the user is on
   ("Current"), and switches via change-plan; `checkout` outcomes fall back to the overlay. "Choose
   a plan" (inactive/trial) still routes to `/pricing`. (Replaced the earlier inline dropdown.)

- **Files:** `internal/paddle/client.go` (+fake), `internal/handler/billing_change_plan.go`,
  `cmd/api/routes.go`, `frontend/.../billing.service.ts`, `plan-billing.component.*`,
  `cognos-api.service.ts`, `interfaces/billing.ts`.
- **Tests:** ✅ integration — change-plan with an existing sub calls Paddle update (correct
  proration per direction); without one returns checkout; final PAYG overage posts on switch. ✅
  client httptest for the PATCH. ✅ frontend unit — changePlan routing (changed→refresh,
  checkout→overlay). ✅ e2e — unauthenticated change-plan → 401.
- **Acceptance:** ✅ switching PAYG↔Unlimited (and monthly↔annual) modifies the one subscription;
  the user is never left with two.

---

### Phase 3 — ✅ Failed payment / dunning → past_due surface

`subscription.past_due` was ignored, so we showed "active" while Paddle had suspended.

1. ✅ **Webhook:** `subscription.past_due` → sets a `past_due` bool on `user_billing` (new migration
   `1760000027`); `subscription.activated` clears it on dunning recovery; `subscription.canceled`
   already → inactive (and clears the flag).
2. ✅ **API:** `GET /api/v1/billing` returns `status: 'past_due'` for a paid plan with the flag
   (takes precedence over `cancels_soon`).
3. ✅ **Frontend:** a shared `app-billing-past-due-banner` ("payment failed — update your card",
   linking to the portal payment deep-link) on the dashboard + chat shell. **Sending is NOT blocked
   during grace** (recommended) — the user keeps working until the `canceled` event locks it.

- **Files:** `1760000027_user_billing_past_due.go`, webhook, `internal/billing/{service,repo}.go`,
  `internal/handler/billing.go`, `interfaces/billing.ts`, `billing.service.ts`, new
  `billing-past-due-banner.component.ts`, `chat.component.*`, `plan-billing.component.*`.
- **Tests:** ✅ integration — past_due event flips the flag + status; recovery clears it; GET
  reports `status:"past_due"`. (Banner render is covered by the existing component specs + manual.)
- **Acceptance:** ✅ a failed renewal shows the dunning banner; recovery (next
  `subscription.activated`) clears it.

---

### Phase 4 — ✅ Transaction recording + overage-retry backstop

1. ✅ **Webhook `transaction.completed`** → `RecordCycleTransaction` links the Paddle transaction to
   the matching open `payg_cycle_summaries` row (`paddle_billed_rappen`, `paddle_transaction_id`,
   `closed_at`), marking `reconciled` when Paddle billed at least the locally-expected amount (a
   safe lower bound). Idempotent on `paddle_transaction_id`.
2. ✅ **Overage-retry backstop** (gocron job, every ~5 min): `RetryUnpostedOverages` re-posts any
   closed cycle with `overage_charge_rappen > 0` and an empty `paddle_overage_txn_id` — the only
   PAYG self-healing path, since a failed charge in the webhook isn't re-dispatched. The
   deterministic idempotency key makes a re-post safe, so it also recovers dropped charges + missed
   rollover webhooks without double-billing.

> **Open item for live verification (Phase 8):** the exact per-cycle amount reconciliation depends
> on Paddle's overage charge **timing** (`effective_from: next_billing_period` → which renewal the
> overage rides) and the transaction line-item structure. With "commit in advance + overage in
> arrears" a single transaction spans two cycles' charges, so we currently record for audit and
> assert only the safe lower bound (`billed ≥ expected`) rather than exact equality. Confirm against
> sandbox data and tighten the `reconciled` check + drift alert then.

- **Files:** `internal/billing/reconcile.go`, `internal/paddle/webhook.go` (transaction totals +
  billing period), `internal/handler/paddle_webhook.go`, `cmd/api/{cron,main,routes}.go`.
- **Tests:** ✅ `cmd/api/billing_reconcile_test.go` — backstop re-posts only unposted overages,
  skips posted/zero, idempotent across passes; ✅ `transaction.completed` records the cycle +
  reconciled.
- **Acceptance:** ✅ a deliberately-dropped/failed overage charge is recovered by the next backstop
  pass; ⏳ exact `reconciled=true` equality pending live Paddle verification (see open item).

---

### Phase 5 — ✅ Refunds (adjustment.created) + REFUNDED invoice status

1. ✅ **Webhook `adjustment.created`** → `recordAdjustment` writes a `refunds` row
   (`gross_refund_rappen`, `net_refund_rappen`, `inside_guarantee_window` from
   `refund_eligible_until_at`, `paddle_adjustment_ids_json` embedding the adjustment id +
   transaction id + action) and sets `users.refund_used` (one-per-lifetime, §7). A `chargeback`
   action also drops the user to `inactive` (§7.5). Idempotent on the adjustment id; `*_reverse`
   actions are ignored. No balance is touched (Paddle already moved the money).
2. ✅ **Invoices REFUNDED badge** — `billing_invoices.go` cross-references the local `refunds`
   ledger (`refundedTransactionIDs`) and maps a refunded transaction's status to `refunded`; the
   dashboard renders a red "Refunded" lozenge.
3. ✅ **Refund request endpoint** `POST /api/v1/billing/refund-request` (spec §12.5) — stubbed:
   logs the request for operator follow-up (email wiring post-MVP) and returns `received`. A
   "Request a refund" link shows on the dashboard inside the 60-day window.

- **Files:** `internal/paddle/webhook.go` (adjustment parser), `internal/handler/paddle_webhook.go`,
  `internal/handler/billing_invoices.go`, new `internal/handler/billing_refund_request.go`,
  `cmd/api/routes.go`, `cognos-api.service.ts`, `plan-billing.component.*`.
- **Tests:** ✅ integration — adjustment writes a refund row + sets refund_used + idempotent;
  chargeback → inactive; invoices endpoint returns `status: refunded` for the affected transaction;
  refund-request 401/accepted.

---

### Phase 6 — ✅ Invoice polish

1. ✅ **Per-invoice PDF download:** `GET /api/v1/billing/invoices/{id}/pdf` (`BillingInvoicePDF`) →
   verifies the transaction's `customer_id` matches the caller's customer
   (`GetTransactionCustomerID`) **before** fetching the invoice (`GET /transactions/{id}/invoice`);
   returns a short-lived URL. The dashboard renders a download icon per row that opens it in a new
   tab (pop-up-safe, via `BillingService.openInvoicePdf`).
2. ✅ **Line descriptions:** `ListInvoices` parses `items[].price.name` + `billing_cycle.interval`
   → e.g. "Unlimited · annual" (`month`→`monthly`, `year`→`annual`); the row falls back to
   "Invoice {number}" when no name is present.

- **Files:** `internal/paddle/client.go`, `internal/handler/billing_invoices.go`, new
  `internal/handler/billing_invoice_pdf.go` + route, `cognos-api.service.ts`, `billing.service.ts`,
  `plan-billing.component.*`, `interfaces/billing.ts`.
- **Tests:** ✅ integration — PDF endpoint 200 for own invoice, **404 for another customer's id**
  (invoice never fetched), 401 unauth; ✅ client httptests — description build (`year`→`annual`),
  PDF URL; ✅ invoices endpoint returns the description.

---

### Phase 7 — ✅ Fair-use / abuse monitoring (Unlimited) — spec §8, §14.11

1. ✅ **Usage aggregation:** `FlagFairUseOutliers` rolls up `balance_transactions` (read-only)
   summing `user_cost_rappen` per Unlimited user over the rolling 30-day window, flagging those over
   `BILLING_UNLIMITED_FAIR_USE_ALERT_RAPPEN` (default CHF 200 = 2× monthly). **Sums the
   authoritative ledger directly** rather than a DuckDB/parquet rollup — that's the analytics-scale
   alternative for later (noted in code).
2. ✅ **Soft action:** the `fairUseReportJob` gocron job (nightly) logs flagged accounts at WARN for
   operator review. **Read-only — never throttles or blocks** (spec §8.1 monitor-only).
3. ✅ **Surface:** structured WARN logs (per-account + a summary count) — the internal report;
   Slack/email routing is a later hook.

> **Also fixed here (migration `1760000028`):** `balance_transactions.amount_rappen` was `required`,
> and PocketBase rejects a required number's `0` as blank — so every Unlimited usage row
> (`amount_rappen=0` by design) and any zero-cost row was being silently dropped in `RecordUsage`,
> starving this monitor + the Unlimited usage dashboard of data. Made it non-required.

- **Files:** `internal/billing/fairuse.go`, `cmd/api/{cron,main}.go`, `internal/config/api.go`,
  migration `1760000028_balance_transactions_amount_optional.go`.
- **Tests:** ✅ integration — heavy Unlimited account flagged, a normal one isn't, PAYG +
  out-of-window rows excluded, none-under-threshold returns empty; ✅ regression — a zero-amount
  Unlimited usage row now persists.
- **Acceptance:** ✅ a synthetic heavy Unlimited account is flagged; normal accounts aren't.

---

### Phase 8 — Production webhook wiring + ops — 📋 runbook written; prod wiring is operator-side

1. ⏳ Production Paddle **notification destination** → `https://<prod-host>/webhooks/paddle`, with
   the signing secret in `COGNOS_PADDLE_WEBHOOK_SECRET` (file/secret, not committed). Subscribe:
   `subscription.created/activated/updated/canceled/past_due`, `transaction.completed`,
   `adjustment.created`. **← operator does this in the live Paddle account.**
2. ⏳ Production Paddle **client token** + price IDs + `paddle.api_base` (live host) in prod config.
   **← operator config/secrets.**
3. ✅ A short **runbook** → `docs/billing-ops-runbook.md`: the full go-live checklist (prices,
   destination, events, every `COGNOS_*` config var), how overage/dunning/refunds/fair-use behave,
   triage (failed webhook, unposted overage, plan↔Paddle drift), and how to issue a goodwill refund.

- **Acceptance:** a sandbox→prod checklist is green (see the runbook §1.4 smoke test); a test event
  reaches prod and is processed (`paddle_events.processed_at` set).

---

### Out of billing scope (track separately)

The remaining settings pages (Account / Usage / Security & keys / Team & sharing /
Notifications) are placeholders — not billing, and not gating launch. List here only so they
aren't forgotten.

## Suggested order

0 → **1 → 2** (launch-blocking) → **3 → 4** (correctness) → **5** → **8** (go-live prerequisite)
→ 6 → 7. Phases 0–5 + 8 are the real "complete billing" launch set; 6–7 can trail shortly after
if needed, but 7 (abuse) should land before heavy Unlimited usage.
