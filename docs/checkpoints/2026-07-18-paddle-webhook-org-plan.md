# Paddle webhook org-subject refactor plan (second-model analysis, 2026-07-18)

**Status: implemented and covered.** The subject-discriminated webhook, Seat updates, pooled cycle
close, lapse behavior, per-user fallback pins, and Organisation billing endpoints landed in
`a148091e`, `ab7a7aaf`, and later red/green hardening commits. This file remains the detailed test
design and historical rationale, not an open implementation queue.

Companion to [2026-07-18-organisations-teams-v1.md](./2026-07-18-organisations-teams-v1.md) §2.
Line refs are from before commit 224c8131; treat as orientation, not gospel.

```go
// closePAYGCycle signature changes from:
//   func closePAYGCycle(ctx, app, params, userID, subscriptionID, cycleStart, cycleEnd)
// to:
func closePAYGCycle(
    ctx context.Context,
    app core.App,
    params PaddleWebhookParams,
    subject Subject,
    subscriptionID string,
    cycleStart, cycleEnd time.Time,
    seatQuantity int, // N seats for pooled floor; 1 for personal (ignored)
) error
```

`sumPAYGUsageRappen` gains a `subject Subject` param and switches SQL filter:

- `SubjectUser`: `WHERE user_id = {:id}`
- `SubjectOrg`: `WHERE organisation = {:id}`

**`recordAdjustment` resolution:**

```go
func resolveAdjustmentSubject(app core.App, adj paddle.AdjustmentData) (Subject, bool) {
    if adj.SubscriptionID != "" {
        if rec, _ := app.FindFirstRecordByData("org_billing", "paddle_subscription_id", adj.SubscriptionID); rec != nil {
            return Subject{Kind: SubjectOrg, ID: rec.GetString("organisation")}, true
        }
        if rec, _ := app.FindFirstRecordByData("user_billing", "paddle_subscription_id", adj.SubscriptionID); rec != nil {
            return Subject{Kind: SubjectUser, ID: rec.GetString("user_id")}, true
        }
    }
    if adj.CustomerID != "" {
        // same fallback chain as resolveWebhookSubject
    }
    return Subject{}, false
}
```

**CycleReconciler interface extension:**

```go
// backend/internal/handler/paddle_webhook.go ~line 48
type CycleReconciler interface {
    RecordCycleTransaction(
        subject Subject,
        subscriptionID, transactionID string,
        billedRappen int64,
        closedAt string,
    ) (bool, error)
}
```

`billing.PocketBaseRepo.RecordCycleTransaction` implements this; it queries the appropriate summary
table (`payg_cycle_summaries` for user, `org_cycle_summaries` for org) by `subscription_id` + cycle
bounds.

---

## 3. PIN-TEST Plan — Lock Current Per-User Behaviour Before Refactoring

Write these tests in `backend/cmd/api/paddle_webhook_test.go` **before** touching the handler. Each
test must pass against the current code; after the refactor they must still pass unchanged (or with
deliberate, documented updates if the abstraction changes test-setup helpers).

| Test Case                                                             | Purpose                                                                                                                                                                              | Fixture / Setup                                                         | Expected Mutation                                                                                                                                     | Idempotency Assert                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `TestPaddleWebhookActivatesSubscription` _(exists)_                   | Pin: `subscription.created` → `user_billing` row created, plan = unlimited, `paddle_subscription_id` set, `refund_eligible_until_at` set, `paddle_customer_id` persisted on `users`. | `subscriptionCreatedBody` with `custom_data.user_id`.                   | `user_billing.plan_type = "unlimited"`, `paddle_subscription_id = "sub_1"`, `paddle_price_id = "pri_unl_monthly"`.                                    | `paddle_events` row has `processed_at` set; re-delivery returns "duplicate".                        |
| `TestPaddleWebhookIsIdempotent` _(exists)_                            | Pin: re-delivery of same `event_id` is a no-op at DB level.                                                                                                                          | Post same body + sig twice.                                             | First: 200 + "ok". Second: 200 + "duplicate".                                                                                                         | `count(paddle_events) == 1` after both.                                                             |
| `TestPaddleWebhookCancelsSubscription` _(exists)_                     | Pin: `subscription.canceled` → `plan_type = inactive`, `paddle_subscription_id` cleared, `plan_ends_at` set.                                                                         | Activate first, then post cancel.                                       | `user_billing.plan_type = "inactive"`, `paddle_subscription_id = ""`.                                                                                 | N/A (canceled is terminal).                                                                         |
| `TestPaddleWebhookUpdatedRollsOverPaygCycle` _(exists)_               | Pin: `subscription.updated` with new `starts_at` > old `starts_at` + PAYG plan → `payg_cycle_summaries` row written, usage summed from `balance_transactions`.                       | `activatePAYG` + seed 2 usage rows inside cycle + 1 outside.            | `payg_cycle_summaries.local_usage_rappen = 2340`, `overage_charge_rappen = 840`, `user_billing.paddle_cycle_start_at` advanced.                       | Re-delivery of same event id returns duplicate (webhook-level).                                     |
| `TestPaddleWebhookRolloverIsIdempotent` _(exists)_                    | Pin: cycle-close idempotency — deterministic `cycleSummaryID` prevents duplicate summary rows on re-delivery.                                                                        | `activatePAYG` + seed usage + post rollover once.                       | `count(payg_cycle_summaries) == 1`.                                                                                                                   | Post same event again → still 1 summary row.                                                        |
| `TestPaddleWebhookRolloverPostsOverageCharge` _(exists)_              | Pin: overage > 0 triggers `CreateOneTimeCharge` with correct subscription, price, quantity (rappen), idempotency key.                                                                | `activatePAYGWithClient(fakeClient)` + seed CHF 23.40 usage.            | `fakeClient.chargeCalls == 1`, `chargeQuantity == 840`, `chargeIdemKey == "overage_" + summaryID`, `summary.paddle_overage_txn_id = "txn_overage_1"`. | Same event re-delivered → charge not called again (webhook dup, but also summary exists guard).     |
| `TestPaddleWebhookRolloverWithinCommitPostsNothing` _(exists)_        | Pin: usage ≤ commit → no charge call, summary row still written with `overage_charge_rappen = 0`.                                                                                    | `activatePAYGWithClient(fakeClient)` + seed CHF 3.42 usage.             | `fakeClient.chargeCalls == 0`, `summary.overage_charge_rappen == 0`, `summary.paddle_overage_txn_id == ""`.                                           | N/A.                                                                                                |
| `TestPaddleWebhookRolloverChargeFailureStillAdvancesCycle` _(exists)_ | Pin: charge failure must not fail webhook; summary persists with `reconciled = false`, `paddle_overage_txn_id = ""`, cycle still advances.                                           | `fakeClient.chargeErr = deadlineExceeded` + seed usage.                 | HTTP 200, `summary.reconciled == false`, `summary.paddle_overage_txn_id == ""`, `user_billing.paddle_cycle_start_at` advanced.                        | N/A.                                                                                                |
| `TestPaddleWebhookUpdatedSurfacesScheduledCancel` _(exists)_          | Pin: `subscription.updated` with `scheduled_change.action = "cancel"` → `plan_ends_at` set; no cycle close if no rollover.                                                           | Activate PAYG, post update with scheduled cancel.                       | `user_billing.plan_ends_at` set, no `payg_cycle_summaries` row.                                                                                       | N/A.                                                                                                |
| `TestPaddleWebhookTransactionCompletedRecordsCycle` _(exists)_        | Pin: `transaction.completed` → `CycleReconciler.RecordCycleTransaction` reconciles summary: `paddle_transaction_id`, `paddle_billed_rappen`, `reconciled = true`.                    | Activate + rollover to create summary, then post transaction.completed. | `summary.paddle_transaction_id = "txn_cycle_1"`, `summary.paddle_billed_rappen = 1500`, `summary.reconciled = true`.                                  | Re-delivery → reconciler may be called again but summary unchanged (reconciler must be idempotent). |
| `TestPaddleWebhookMarksAndClearsPastDue` _(exists)_                   | Pin: `subscription.past_due` → `past_due = true` (plan stays active); `subscription.activated` → `past_due = false`.                                                                 | Activate, post past_due, post recovery activate.                        | After past_due: `past_due = true`, `plan_type = "unlimited"`. After recovery: `past_due = false`.                                                     | N/A.                                                                                                |
| `TestPaddleWebhookAdjustmentRecordsRefund` _(exists)_                 | Pin: `adjustment.created` (refund) → `refunds` row, `inside_guarantee_window` calculated, `users.refund_used = true`.                                                                | Activate, post adjustment.                                              | `refunds` row with `gross_refund_rappen = 10000`, `inside_guarantee_window = true`, `users.refund_used = true`.                                       | Re-delivery → `count(refunds) == 1`.                                                                |
| `TestPaddleWebhookChargebackDeactivates` _(exists)_                   | Pin: `adjustment.created` (chargeback) → `plan_type = inactive`, `paddle_subscription_id = ""`.                                                                                      | Activate, post chargeback adjustment.                                   | `user_billing.plan_type = "inactive"`, `user_billing.paddle_subscription_id = ""`.                                                                    | N/A.                                                                                                |
| `TestPaddleWebhookIgnoresUnmappableUser` _(exists)_                   | Pin: event with no resolvable user → stored in `paddle_events`, HTTP 200, no plan change.                                                                                            | Body with unknown customer, no custom_data.                             | `count(paddle_events) == 1`, test user's plan still "trial".                                                                                          | N/A.                                                                                                |

**New PIN tests to add (user-specific edge cases not yet covered):**

| Test Case                                          | Purpose                                                                                                                              | Fixture / Setup                                                                                             | Expected Mutation                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `TestPaddleWebhookActivateFallbackToCustomerID`    | Pin: `custom_data.user_id` missing but `customer_id` matches existing `users.paddle_customer_id` → activation succeeds.              | Create user with `paddle_customer_id = "ctm_1"`, post `subscription.created` without `custom_data.user_id`. | `user_billing` row created for that user. |
| `TestPaddleWebhookUpdateFallsBackToSubscriptionID` | Pin: `subscription.updated` with unresolvable `custom_data.user_id` but known `subscription_id` in `user_billing` → update succeeds. | Activate, then post update with different `custom_data.user_id` but same `subscription_id`.                 | Cycle advances / snapshot updates.        |
| `TestPaddleWebhookAdjustmentFallsBackToCustomerID` | Pin: adjustment with unknown subscription but known `customer_id` on user → maps correctly.                                          | Activate user with `paddle_customer_id`, post adjustment with different `subscription_id`.                  | `refunds` row created for correct user.   |

---

### 4. Org-Specific New Tests Needed After Refactor

These tests belong in `backend/cmd/api/paddle_webhook_test.go` (or a new
`org_paddle_webhook_test.go` if the file grows too large). Each exercises a behaviour that has
**no user equivalent** or differs materially.

| Test Case                                                    | Purpose                                                                                                                             | Fixture / Setup                                                                                             | Expected Mutation                                                                                                                                             | Org-Specific Assert                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `TestOrgPaddleWebhookActivatesOrgSubscription`               | Org `subscription.created` with `custom_data.org_id` creates `org_billing`, sets `seat_quantity = 3`, activates creator membership. | Create `organisations` row, post `subscription.created` with `custom_data.org_id`, `items[0].quantity = 3`. | `org_billing.plan_type = "payg"`, `org_billing.seat_quantity = 3`, `org_billing.paddle_subscription_id = "sub_org_1"`, creator membership `is_active = true`. | `organisations.paddle_customer_id` persisted; no `user_billing` touched.                             |
| `TestOrgPaddleWebhookSeatQuantitySync`                       | `subscription.updated` with new item quantity updates `org_billing.seat_quantity` to match Paddle.                                  | Org activated with qty 3, post update with `items[0].quantity = 5`.                                         | `org_billing.seat_quantity = 5`.                                                                                                                              | Quantity reflects active seats; `pending_seat_quantity` unchanged if no pending decrement.           |
| `TestOrgPaddleWebhookPooledOverage`                          | Org cycle rollover computes `overage = max(0, total_usage − N × 1500)` where N = `seat_quantity`.                                   | Org with 3 seats (qty 3), seed usage rows with `organisation = orgID` totalling CHF 52.00 (5200 rappen).    | `org_cycle_summaries.local_usage_rappen = 5200`, `overage_charge_rappen = 5200 − 4500 = 700`.                                                                 | One `CreateOneTimeCharge` call with quantity 700; idempotency key derived from `sub_id + cycle_end`. |
| `TestOrgPaddleWebhookPooledNoOverage`                        | Org usage ≤ pooled floor → no charge, summary shows `overage_charge_rappen = 0`.                                                    | Org with 3 seats, seed usage totalling CHF 30.00 (3000 rappen).                                             | `overage_charge_rappen = 0` (3000 ≤ 4500).                                                                                                                    | No charge call; summary still written.                                                               |
| `TestOrgPaddleWebhookSeatRemoveNextCycle`                    | `pending_seat_quantity` applies at rollover, clamped to the three-Seat minimum.                                                     | Org with `seat_quantity = 4`, `pending_seat_quantity = 2` (members removed below minimum), post rollover.   | After rollover: `seat_quantity = 3`, `pending_seat_quantity = null`.                                                                                          | Cycle close uses old `seat_quantity = 4` for floor calculation; next cycle clamps to 3, not 2.       |
| `TestOrgPaddleWebhookPastDueLapsesOrg`                       | `subscription.past_due` on org → `org_billing.past_due = true`; org Projects become read-only.                                      | Activate org, create org-owned Project, post `subscription.past_due`.                                       | `org_billing.past_due = true`; completion in org Project returns 402.                                                                                         | Personal projects unaffected; member's `user_billing` untouched.                                     |
| `TestOrgPaddleWebhookCancelLapsesOrg`                        | `subscription.canceled` on org → `plan_type = inactive`; org Projects read-only.                                                    | Activate org, post cancel.                                                                                  | `org_billing.plan_type = "inactive"`; 402 on org Project completions.                                                                                         | Reactivation restores write access.                                                                  |
| `TestOrgPaddleWebhookReactivationClearsPastDue`              | `subscription.activated` on past-due org clears `past_due`, restores write access.                                                  | Org past_due, post recovery activate.                                                                       | `org_billing.past_due = false`, `plan_type = "payg"`; completions succeed.                                                                                    | Read-only gate lifted.                                                                               |
| `TestOrgPaddleWebhookFailClosedNoPersonalFallback`           | Completion in org Project with lapsed org billing must NOT deduct from member's personal balance.                                   | Member has personal trial balance, org is inactive, member tries completion in org Project.                 | HTTP 402; member's `user_billing.balance_microrappen` unchanged.                                                                                              | Explicit assert: personal balance == initial value.                                                  |
| `TestOrgPaddleWebhookOrgAdjustmentMapsToOrg`                 | `adjustment.created` on org subscription writes `refunds` row with `organisation` relation.                                         | Org activated, post refund adjustment.                                                                      | `refunds.organisation = orgID`; `refunds.user_id` may be empty or set to admin for audit.                                                                     | No `users.refund_used` flag set (org has no per-person refund limit in v1).                          |
| `TestOrgPaddleWebhookOrgChargebackDeactivates`               | Chargeback on org → `org_billing.plan_type = inactive`, lapse org Projects.                                                         | Org activated, post chargeback.                                                                             | `org_billing.plan_type = "inactive"`; 402 on org Project completions.                                                                                         | No user billing touched.                                                                             |
| `TestOrgPaddleWebhookTransactionCompletedReconcilesOrgCycle` | `transaction.completed` for org subscription reconciles `org_cycle_summaries`.                                                      | Org activated, rollover to create summary, post transaction.completed.                                      | `org_cycle_summaries.reconciled = true`, `paddle_transaction_id` set, `paddle_billed_rappen` set.                                                             | Same reconciler interface, different table.                                                          |
| `TestOrgPaddleWebhookIdempotentOnOrgEvent`                   | Re-delivery of org event is duplicate at `paddle_events` level.                                                                     | Post org activation twice.                                                                                  | `count(paddle_events) == 1`, `count(org_billing) == 1`.                                                                                                       | Same idempotency mechanism.                                                                          |
| `TestOrgPaddleWebhookUnknownOrgIgnored`                      | `custom_data.org_id` pointing to non-existent org → stored, HTTP 200, no crash.                                                     | Post subscription.created with `custom_data.org_id = "nonexistent"`.                                        | `count(paddle_events) == 1`, no `org_billing` row.                                                                                                            | Graceful ignore, matching user unmappable behaviour.                                                 |

---

### Summary of Files Touched

| File                                         | Action                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/internal/handler/paddle_webhook.go` | Add `Subject` type + `SubjectKind`; replace `resolveWebhookUserID` → `resolveWebhookSubject`; replace `upsertUserBilling` → `upsertBilling`; update `activateSubscription`, `cancelSubscription`, `updateSubscription`, `markSubscriptionPastDue`, `recordAdjustment`, `resolveAdjustmentUserID`, `closePAYGCycle`, `sumPAYGUsageRappen` signatures; add `persistPaddleCustomerID` helper. |
| `backend/internal/handler/paddle_webhook.go` | Update `CycleReconciler` interface to accept `Subject`.                                                                                                                                                                                                                                                                                                                                    |
| `backend/internal/billing/repo.go`           | Extend `RecordCycleTransaction` to query `org_cycle_summaries` when `subject.Kind == SubjectOrg`.                                                                                                                                                                                                                                                                                          |
| `backend/internal/billing/repo.go`           | Add `StateForOrg(orgID string) (State, error)` and `billingRecordsForOrg` helpers (parallel to user variants).                                                                                                                                                                                                                                                                             |
| `backend/cmd/api/paddle_webhook_test.go`     | Add PIN tests for user fallback behaviours; add all org-specific tests.                                                                                                                                                                                                                                                                                                                    |
| `docs/api-permissions.md`                    | Register new org webhook endpoints (same path, but subject discriminator changes auth implications).                                                                                                                                                                                                                                                                                       |
