package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Creates the Paddle bookkeeping collections (spec §9.2): the raw webhook log,
// the refund ledger, pre-staged trial seed overrides, and PAYG cycle summaries.
// All keep their API rules nil so they are reachable only by superusers / our
// server-side handlers — never the public auto API.
func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "pdlevt9k2m4x7q1",
				"name": "paddle_events",
				"type": "base",
				"system": false,
				"fields": [
					{
						"id": "txtpdlevtid1",
						"name": "paddle_event_id",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "dtpdlrecv001",
						"name": "received_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "txtpdlevttp1",
						"name": "type",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtpdlecust1",
						"name": "paddle_customer_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtpdlesub01",
						"name": "paddle_subscription_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtpdletxn01",
						"name": "paddle_transaction_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtpdlpaylod",
						"name": "payload_json",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "dtpdlproc001",
						"name": "processed_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "txtpdlerr001",
						"name": "processing_error",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX idx_paddle_events_event_id ON paddle_events (paddle_event_id)",
					"CREATE INDEX idx_paddle_events_customer ON paddle_events (paddle_customer_id)",
					"CREATE INDEX idx_paddle_events_subscription ON paddle_events (paddle_subscription_id)",
					"CREATE INDEX idx_paddle_events_transaction ON paddle_events (paddle_transaction_id)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "refnd8s3v6n1p2w",
				"name": "refunds",
				"type": "base",
				"system": false,
				"fields": [
					{
						"id": "relrefnduser",
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
						"id": "dtrefnreq001",
						"name": "requested_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "dtrefnproc01",
						"name": "processed_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "numrefngross",
						"name": "gross_refund_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					},
					{
						"id": "numrefndeduc",
						"name": "usage_deduction_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					},
					{
						"id": "numrefnnet01",
						"name": "net_refund_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					},
					{
						"id": "txtrefnreasn",
						"name": "reason_text",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtrefnopr01",
						"name": "operator_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtrefnadjid",
						"name": "paddle_adjustment_ids_json",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "boolrefnwind",
						"name": "inside_guarantee_window",
						"type": "bool",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {}
					}
				],
				"indexes": [
					"CREATE INDEX idx_refunds_user_id ON refunds (user_id)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "trseed5h9j3c7b2",
				"name": "trial_seed_overrides",
				"type": "base",
				"system": false,
				"fields": [
					{
						"id": "txttrseedeml",
						"name": "email",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "numtrseedrpn",
						"name": "rappen",
						"type": "number",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": true}
					},
					{
						"id": "txttrseedrsn",
						"name": "reason_text",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txttrseedsby",
						"name": "set_by",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "dttrseedset1",
						"name": "set_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "dttrseedexp1",
						"name": "expires_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "dttrseedcon1",
						"name": "consumed_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX idx_trial_seed_overrides_email ON trial_seed_overrides (email)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "paygcy4t8r2k6m1",
				"name": "payg_cycle_summaries",
				"type": "base",
				"system": false,
				"fields": [
					{
						"id": "relpayguser1",
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
						"id": "dtpaygstart1",
						"name": "cycle_start_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "dtpaygend001",
						"name": "cycle_end_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					},
					{
						"id": "txtpaygsub01",
						"name": "paddle_subscription_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "txtpaygtxn01",
						"name": "paddle_transaction_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "numpaygusage",
						"name": "local_usage_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "numpaygexpct",
						"name": "local_expected_bill_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "numpaygoverg",
						"name": "overage_charge_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "txtpaygovtxn",
						"name": "paddle_overage_txn_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "numpaygbilld",
						"name": "paddle_billed_rappen",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "noDecimal": true}
					},
					{
						"id": "boolpaygrecn",
						"name": "reconciled",
						"type": "bool",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {}
					},
					{
						"id": "dtpaygclose1",
						"name": "closed_at",
						"type": "date",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": "", "max": ""}
					}
				],
				"indexes": [
					"CREATE INDEX idx_payg_cycle_summaries_user_id ON payg_cycle_summaries (user_id)",
					"CREATE INDEX idx_payg_cycle_summaries_subscription ON payg_cycle_summaries (paddle_subscription_id)"
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
			"payg_cycle_summaries", "trial_seed_overrides", "refunds", "paddle_events",
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
