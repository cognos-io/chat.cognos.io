# PAYG overage-cycle validation

**Status:** required production launch evidence; not yet validated

Complete this once against Paddle live mode with a company-owned synthetic Account. Never use a real
customer merely to exercise billing, and never record payment credentials or Paddle secrets here.

## Pass criteria

- The opening transaction charges exactly CHF 15 plus applicable tax and identifies the monthly
  minimum clearly.
- Content-free ledger usage for the closed cycle exceeds CHF 15 and matches the expected 22% markup
  and captured FX rates.
- `subscription.updated` creates exactly one `payg_cycle_summaries` row and one overage request with
  idempotency key `overage_<cycle_id>`.
- Re-delivering the event and running the five-minute backstop create no duplicate charge.
- The overage appears in the expected Paddle transaction with understandable invoice wording.
- `transaction.completed` records the Paddle transaction and billed Rappen; local expected and
  billed values reconcile under the documented timing rule.
- The Account billing page and invoice PDF show the same Plan, cycle and totals.
- No payload, log or evidence artifact contains Message content, Account Keys or payment secrets.

## Evidence record

```markdown
- Validation date (UTC):
- Release commit and backend image digest:
- Operator / reviewer:
- Synthetic Account reference (restricted system only):
- Paddle product and price IDs checked against the canonical catalogue: yes | no
- Cycle start / end (UTC):
- Local usage (Rappen):
- Expected minimum / overage / total (Rappen):
- Paddle minimum / overage / total (Rappen):
- Overage landed on transaction/cycle:
- Idempotency replay result:
- Backstop replay result:
- Reconciled: yes | no
- Invoice wording checked: yes | no
- Evidence location (access-controlled):
- Deviations, owner and due date:
- Decision: pass | fail
- Reviewer sign-off:
```

Do not mark this passed when a duplicate, unexplained reconciliation difference, unclear invoice or
missing evidence remains.
