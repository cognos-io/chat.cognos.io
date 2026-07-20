package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds three policy columns to organisations (spec docs/specs/organisations.md
// §11 Phase 2 — enforced policies):
//
//   - policy_privacy_tier: select (ch_only | eu | global), optional. Acts as a
//     CEILING for completions in this org's projects — the effective ceiling is
//     the more restrictive of the member's personal tier and the org ceiling.
//   - policy_retention_days: number, optional. When >0, new conversations
//     created/moved into org projects get this expiry_duration unless the
//     conversation already has a stricter (shorter) own setting.
//   - policy_mfa_required: bool, default false. When true, members must have
//     mfa_enabled to read or write in org-owned projects.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("organisations")
		if err != nil {
			return err
		}

		fields := []string{
			`{"system":false,"id":"orgpolpriv0001","name":"policy_privacy_tier","type":"select","required":false,"presentable":false,"unique":false,"options":{"maxSelect":1,"values":["ch_only","eu","global"]}}`,
			`{"system":false,"id":"orgpolretd001","name":"policy_retention_days","type":"number","required":false,"presentable":false,"unique":false,"options":{"min":0,"max":null,"noDecimal":true}}`,
			`{"system":false,"id":"orgpolmfa0001","name":"policy_mfa_required","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`,
		}

		for _, field := range fields {
			if err := addLegacyField(app, collection, field); err != nil {
				return err
			}
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("organisations")
		if err != nil {
			return err
		}

		collection.Fields.RemoveById("orgpolpriv0001")
		collection.Fields.RemoveById("orgpolretd001")
		collection.Fields.RemoveById("orgpolmfa0001")
		return app.Save(collection)
	})
}
