package migrations

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// The seed data dir is empty, so booting a TestApp replays every registered
// migration from scratch — i.e. this asserts the live schema the migrations
// produce.
const migrationsTestDataDir = "../../testdata/seed"

func bootMigratedApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp(migrationsTestDataDir)
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })
	return app
}

func mustCollection(t *testing.T, app core.App, name string) *core.Collection {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		t.Fatalf("collection %q not found: %v", name, err)
	}
	return collection
}

func assertHasFields(t *testing.T, c *core.Collection, names ...string) {
	t.Helper()
	for _, name := range names {
		if c.Fields.GetByName(name) == nil {
			t.Errorf("collection %q is missing field %q", c.Name, name)
		}
	}
}

func assertNoFields(t *testing.T, c *core.Collection, names ...string) {
	t.Helper()
	for _, name := range names {
		if c.Fields.GetByName(name) != nil {
			t.Errorf("collection %q should not have field %q", c.Name, name)
		}
	}
}

// Sunny path: every billing collection uses Paddle field names, the legacy
// Polar names are gone, and the new Paddle tables exist with their key fields.
func TestPaddleBillingSchema(t *testing.T) {
	app := bootMigratedApp(t)

	t.Run("user_billing uses paddle fields", func(t *testing.T) {
		c := mustCollection(t, app, "user_billing")
		assertHasFields(t, c,
			"plan_type", "balance_rappen", "trial_seed_granted_rappen",
			"paddle_subscription_id", "paddle_price_id",
			"paddle_cycle_start_at", "paddle_cycle_end_at",
			"refund_eligible_until_at",
			"payg_soft_alert_cycle_start_at",
		)
		assertNoFields(t, c,
			"polar_subscription_id", "polar_product_id",
			"polar_cycle_start_at", "polar_cycle_end_at",
		)
	})

	t.Run("balance_transactions uses paddle fields", func(t *testing.T) {
		c := mustCollection(t, app, "balance_transactions")
		assertHasFields(t, c,
			"type", "amount_rappen", "provider_cost_rappen", "user_cost_rappen",
			"fx_rate_usd_chf", "paddle_transaction_id",
		)
		assertNoFields(t, c, "polar_order_id", "polar_meter_event_id", "polar_pushed_at")
	})

	t.Run("users carries billing + business fields", func(t *testing.T) {
		c := mustCollection(t, app, "users")
		assertHasFields(t, c,
			"display_name", "refund_used", "paddle_customer_id",
			"business_name", "business_vat_id", "business_country",
		)
	})

	t.Run("users carries avatar icon + colour fields", func(t *testing.T) {
		c := mustCollection(t, app, "users")
		assertHasFields(t, c, "avatar_icon", "avatar_color")
	})

	t.Run("paddle_events exists", func(t *testing.T) {
		c := mustCollection(t, app, "paddle_events")
		assertHasFields(t, c,
			"paddle_event_id", "received_at", "type", "paddle_customer_id",
			"paddle_subscription_id", "paddle_transaction_id", "payload_json",
			"processed_at", "processing_error",
		)
	})

	t.Run("refunds exists", func(t *testing.T) {
		c := mustCollection(t, app, "refunds")
		assertHasFields(t, c,
			"user_id", "gross_refund_rappen", "usage_deduction_rappen",
			"net_refund_rappen", "reason_text", "operator_id",
			"paddle_adjustment_ids_json", "inside_guarantee_window",
		)
	})

	t.Run("trial_seed_overrides exists", func(t *testing.T) {
		c := mustCollection(t, app, "trial_seed_overrides")
		assertHasFields(t, c, "email", "rappen", "reason_text", "set_by", "expires_at", "consumed_at")
	})

	t.Run("payg_cycle_summaries exists", func(t *testing.T) {
		c := mustCollection(t, app, "payg_cycle_summaries")
		assertHasFields(t, c,
			"user_id", "cycle_start_at", "cycle_end_at", "paddle_subscription_id",
			"local_usage_rappen", "local_expected_bill_rappen", "overage_charge_rappen",
			"paddle_billed_rappen", "reconciled",
		)
	})

	// Security: billing collections must not be reachable through the auto API.
	t.Run("billing collections are not publicly accessible", func(t *testing.T) {
		for _, name := range []string{
			"user_billing", "balance_transactions", "paddle_events",
			"refunds", "trial_seed_overrides", "payg_cycle_summaries",
		} {
			c := mustCollection(t, app, name)
			if c.ListRule != nil || c.ViewRule != nil || c.CreateRule != nil ||
				c.UpdateRule != nil || c.DeleteRule != nil {
				t.Errorf("collection %q must keep all API rules nil (superuser-only)", name)
			}
		}
	})
}

func TestPersonasSchemaStoresEncryptedUserOwnedData(t *testing.T) {
	app := bootMigratedApp(t)
	c := mustCollection(t, app, "personas")

	// `created`/`updated` are required: PersonasList sorts by `-updated` and the
	// API serialises both, so a collection without them returns 500 on every
	// authenticated list.
	assertHasFields(t, c, "user", "data", "created", "updated")
	for _, field := range []string{"name", "description", "system_prompt"} {
		if c.Fields.GetByName(field) != nil {
			t.Errorf("personas collection must not store plaintext field %q", field)
		}
	}
	if c.ListRule == nil || c.ViewRule == nil || c.CreateRule == nil || c.UpdateRule == nil || c.DeleteRule == nil {
		t.Fatal("personas collection must have owner-scoped API rules")
	}
}

// Edge: the Paddle event id is the natural idempotency key — re-inserting the
// same event id must be rejected so webhook re-delivery is a no-op.
func TestPaddleEventsRejectDuplicateID(t *testing.T) {
	app := bootMigratedApp(t)
	collection := mustCollection(t, app, "paddle_events")

	first := core.NewRecord(collection)
	first.Set("paddle_event_id", "evt_dedupe_001")
	first.Set("type", "subscription.created")
	first.Set("payload_json", "{}")
	if err := app.Save(first); err != nil {
		t.Fatalf("first save should succeed: %v", err)
	}

	dup := core.NewRecord(collection)
	dup.Set("paddle_event_id", "evt_dedupe_001")
	dup.Set("type", "subscription.created")
	dup.Set("payload_json", "{}")
	if err := app.Save(dup); err == nil {
		t.Fatal("expected duplicate paddle_event_id to be rejected")
	}
}

// Edge: a trial seed override is keyed on email; duplicates must be rejected so
// the signup hook reads a single deterministic override.
func TestTrialSeedOverridesUniqueEmail(t *testing.T) {
	app := bootMigratedApp(t)
	collection := mustCollection(t, app, "trial_seed_overrides")

	first := core.NewRecord(collection)
	first.Set("email", "invite@example.com")
	first.Set("rappen", 500)
	if err := app.Save(first); err != nil {
		t.Fatalf("first override save should succeed: %v", err)
	}

	dup := core.NewRecord(collection)
	dup.Set("email", "invite@example.com")
	dup.Set("rappen", 999)
	if err := app.Save(dup); err == nil {
		t.Fatal("expected duplicate trial_seed_overrides email to be rejected")
	}
}
