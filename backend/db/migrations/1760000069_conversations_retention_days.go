package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the per-conversation auto-delete override to the conversations
// collection. Like the account-level default (users.default_retention_days),
// retention is metadata, not chat content, so it is stored in plaintext so the
// background deletion job can resolve the effective window server-side.
//
// Value semantics (days) — a signed sentinel encoding so a null column reads
// as the natural default without an ambiguous null-vs-0 check in Go:
//
//	0 (or unset) → inherit the creator's account default. This is the default
//	              for every fresh conversation.
//	-1           → never delete (explicit override, even if the account opts in).
//	N > 0        → delete this conversation N days after its last activity,
//	              overriding the account default.
//
// Only {0 (inherit), -1 (never), 7, 30} are surfaced in the UI. The window is
// always measured from last_activity_at (falling back to updated/created when
// unset), never creation time.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversations")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "numretaindays1",
			"name": "retention_days",
			"type": "number",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"min": -1, "max": 3650, "noDecimal": true}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversations")
		if err != nil {
			return err
		}

		collection.Fields.RemoveById("numretaindays1")
		return app.Save(collection)
	})
}
