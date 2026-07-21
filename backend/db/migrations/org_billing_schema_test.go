package migrations

import "testing"

// Pins the org billing schema (docs/business_processes/organisation-lifecycle.md):
// org_billing is balance-free (orgs are pure pooled PAYG — no trial, no
// prepaid credit), org_cycle_summaries mirrors payg_cycle_summaries plus the
// pooled seat dimension, and balance_transactions gains the optional
// organisation attribution while keeping user_id for audit. All three stay
// locked (nil rules) like every other billing collection.
func TestOrgBillingSchema(t *testing.T) {
	app := bootMigratedApp(t)

	t.Run("org_billing exists and is balance-free", func(t *testing.T) {
		c := mustCollection(t, app, "org_billing")
		assertHasFields(t, c,
			"organisation", "plan_type",
			"paddle_customer_id", "paddle_subscription_id", "paddle_price_id",
			"paddle_cycle_start_at", "paddle_cycle_end_at",
			"seat_quantity", "pending_seat_quantity", "past_due",
		)
		// Orgs have no trial and no prepaid balance: the gate fails closed on
		// a missing/inactive row instead of depleting anything.
		assertNoFields(t, c, "balance_rappen", "balance_microrappen", "trial_seed_granted_rappen")
	})

	t.Run("org_cycle_summaries mirrors payg_cycle_summaries plus seats", func(t *testing.T) {
		c := mustCollection(t, app, "org_cycle_summaries")
		assertHasFields(t, c,
			"organisation", "paddle_subscription_id",
			"cycle_start_at", "cycle_end_at",
			"seat_quantity",
			"pooled_usage_rappen", "pooled_usage_microrappen",
			"local_expected_bill_rappen", "overage_charge_rappen",
			"paddle_overage_txn_id", "paddle_transaction_id",
			"paddle_billed_rappen", "reconciled", "closed_at",
		)
	})

	t.Run("balance_transactions gains org attribution and keeps user_id", func(t *testing.T) {
		c := mustCollection(t, app, "balance_transactions")
		assertHasFields(t, c, "organisation", "user_id")
	})

	t.Run("org billing collections are locked", func(t *testing.T) {
		for _, name := range []string{"org_billing", "org_cycle_summaries"} {
			c := mustCollection(t, app, name)
			if c.ListRule != nil || c.ViewRule != nil || c.CreateRule != nil ||
				c.UpdateRule != nil || c.DeleteRule != nil {
				t.Errorf("collection %q must keep nil API rules; access flows through /api/v1 only", name)
			}
		}
	})
}
