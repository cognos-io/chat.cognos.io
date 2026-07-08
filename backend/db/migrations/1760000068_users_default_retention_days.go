package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the account-level default auto-delete window to the users collection.
//
// Retention is metadata, NOT chat content: it is deliberately stored in
// plaintext on the user record (like preferred_language / preferred_theme) so
// the background deletion job can read it server-side without a vault unlock,
// and so the choice follows the user across devices. It is self-updatable via
// the built-in users collection API (updateRule `id = @request.auth.id`),
// mirroring how the other plaintext account preferences are written.
//
// Value semantics (days):
//
//	0 (or unset) → never delete — the product default. Nothing is ever removed
//	              on a timer unless the user opts in.
//	N > 0        → delete conversations N days after their last activity, unless
//	              a conversation overrides the window itself.
//
// Only {7, 30, 0} are surfaced in the UI; the column simply persists the choice
// and is bounded to a sane range so date arithmetic can never overflow.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("_pb_users_auth_")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "numdefretain1",
			"name": "default_retention_days",
			"type": "number",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"min": 0, "max": 3650, "noDecimal": true}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("_pb_users_auth_")
		if err != nil {
			return err
		}

		collection.Fields.RemoveById("numdefretain1")
		return app.Save(collection)
	})
}
