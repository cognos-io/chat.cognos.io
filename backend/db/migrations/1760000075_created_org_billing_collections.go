package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Org billing collections (spec docs/specs/organisations.md §6.4/§6.7).
//
//   - org_billing is the per-Organisation sibling of user_billing. It is
//     deliberately BALANCE-FREE: Organisations have no trial and no prepaid
//     credit, only pooled PAYG (seat floor + overage), so there is nothing to
//     deplete and a missing/inactive row simply fails the billing gate closed
//     (HTTP 402) — it must never fall back to a member's personal balance.
//     plan_type is a select (payg | inactive) rather than user_billing's free
//     text because orgs support exactly those two states in v1.
//   - org_cycle_summaries mirrors payg_cycle_summaries one-for-one so the
//     Paddle reconciliation tooling can treat both settlement tables the same,
//     plus seat_quantity (the N of the pooled floor N x CHF 15) and the pooled
//     usage in both rappen and micro-rappen (micro-rappen is the accounting
//     source of truth; rappen is the ceiled charge projection).
//
// As with user_billing every rule is null: the /api/collections/* surface is
// locked (403) for everyone and all access flows through /api/v1 handlers.
func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "orgbilling0001",
				"name": "org_billing",
				"type": "base",
				"system": false,
				"fields": [
					{
						"id": "relorgbillorg1",
						"name": "organisation",
						"type": "relation",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "organisations01",
							"cascadeDelete": false,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"id": "selorgbillplan",
						"name": "plan_type",
						"type": "select",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"maxSelect": 1,
							"values": ["payg", "inactive"]
						}
					},
					{
						"id": "txtorgbillcust",
						"name": "paddle_customer_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtorgbillsub1",
						"name": "paddle_subscription_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtorgbillpric",
						"name": "paddle_price_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "dtorgbillfrom1",
						"name": "paddle_cycle_start_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "dtorgbillto001",
						"name": "paddle_cycle_end_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "numorgbillseat",
						"name": "seat_quantity",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					},
					{
						"id": "numorgbillpend",
						"name": "pending_seat_quantity",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					},
					{
						"id": "boolorgbilldue",
						"name": "past_due",
						"type": "bool",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {}
					},
					{
						"id": "dtorgbillcrea1",
						"name": "created",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": false
					},
					{
						"id": "dtorgbillupda1",
						"name": "updated",
						"type": "autodate",
						"presentable": false,
						"hidden": false,
						"onCreate": true,
						"onUpdate": true
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX ` + "`" + `idx_org_billing_organisation` + "`" + ` ON ` + "`" + `org_billing` + "`" + ` (` + "`" + `organisation` + "`" + `)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "orgcyclesumm01",
				"name": "org_cycle_summaries",
				"type": "base",
				"system": false,
				"fields": [
					{
						"id": "relorgcycorg01",
						"name": "organisation",
						"type": "relation",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "organisations01",
							"cascadeDelete": false,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"id": "txtorgcycsub01",
						"name": "paddle_subscription_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "dtorgcycstart1",
						"name": "cycle_start_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "dtorgcycend001",
						"name": "cycle_end_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "numorgcycseats",
						"name": "seat_quantity",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					},
					{
						"id": "numorgcycusage",
						"name": "pooled_usage_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "numorgcycmicro",
						"name": "pooled_usage_microrappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "numorgcycexpct",
						"name": "local_expected_bill_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "numorgcycoverg",
						"name": "overage_charge_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "txtorgcycovtxn",
						"name": "paddle_overage_txn_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtorgcyctxn01",
						"name": "paddle_transaction_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "numorgcycbilld",
						"name": "paddle_billed_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "boolorgcycrecn",
						"name": "reconciled",
						"type": "bool",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {}
					},
					{
						"id": "dtorgcycclose1",
						"name": "closed_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					}
				],
				"indexes": [
					"CREATE INDEX ` + "`" + `idx_org_cycle_summaries_organisation` + "`" + ` ON ` + "`" + `org_cycle_summaries` + "`" + ` (` + "`" + `organisation` + "`" + `)",
					"CREATE INDEX ` + "`" + `idx_org_cycle_summaries_subscription` + "`" + ` ON ` + "`" + `org_cycle_summaries` + "`" + ` (` + "`" + `paddle_subscription_id` + "`" + `)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			}
		]`

		return importLegacyCollections(app, jsonData, false)
	}, func(app core.App) error {
		for _, name := range []string{
			"org_cycle_summaries",
			"org_billing",
		} {
			collection, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				continue
			}
			if err := app.Delete(collection); err != nil {
				return err
			}
		}
		return nil
	})
}
