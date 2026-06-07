package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "l9j4prm8t2w6x7q",
				"name": "user_billing",
				"type": "base",
				"system": false,
				"fields": [
					{
						"id": "reluserbill1",
						"name": "user_id",
						"type": "relation",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "_pb_users_auth_",
							"cascadeDelete": false,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"id": "txtplanbill1",
						"name": "plan_type",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "numbalance1",
						"name": "balance_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					},
					{
						"id": "dtplanstart1",
						"name": "plan_started_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "dtplanends01",
						"name": "plan_ends_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "txtpolsub001",
						"name": "polar_subscription_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtpolprod01",
						"name": "polar_product_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "dtcyclefrom1",
						"name": "polar_cycle_start_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "dtcycleto001",
						"name": "polar_cycle_end_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "dtrefund001",
						"name": "refund_eligible_until_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "numtrialseed1",
						"name": "trial_seed_granted_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX idx_user_billing_user_id ON user_billing (user_id)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "z4n7q2m5p8s1v6x",
				"name": "balance_transactions",
				"type": "base",
				"system": false,
				"fields": [
					{
						"id": "reltxuser001",
						"name": "user_id",
						"type": "relation",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "_pb_users_auth_",
							"cascadeDelete": false,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": null
						}
					},
					{
						"id": "dttxoccur01",
						"name": "occurred_at",
						"type": "date",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "txttxtype01",
						"name": "type",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "numamount001",
						"name": "amount_rappen",
						"type": "number",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "numbalafter1",
						"name": "balance_after_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "txteventid01",
						"name": "event_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtpolarord1",
						"name": "polar_order_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtpolmeter1",
						"name": "polar_meter_event_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "dtpolpush001",
						"name": "polar_pushed_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "numprovcost1",
						"name": "provider_cost_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "numusercost1",
						"name": "user_cost_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "numfxrate001",
						"name": "fx_rate_usd_chf",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": false}
					},
					{
						"id": "txtdesctx01",
						"name": "description",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtplantx001",
						"name": "plan_type",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtmodeltx01",
						"name": "model_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "numinputtok1",
						"name": "input_tokens",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					},
					{
						"id": "numoutputt1",
						"name": "output_tokens",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX idx_balance_transactions_event_id ON balance_transactions (event_id)"
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
		for _, name := range []string{"balance_transactions", "user_billing"} {
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
