package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Stamp every conversation_secret_keys row with the conversation generation
// it was wrapped against. With both `conversations.key_version` and
// `conversation_secret_keys.key_version` in place, rotation can:
//
//   - bump the conversation's key_version,
//   - re-wrap the conversation secret key for remaining participants at
//     the new version,
//   - and treat any secret_keys row whose key_version no longer matches
//     the conversation's current generation as stale.
//
// This migration only introduces the column with a default of 1 and
// backfills existing rows. The "filter by current version" read path
// lands with the rotation slice — keeping the schema move on its own
// makes it easier to revert if anything goes wrong with the column add.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversation_secret_keys")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "numseckv001",
			"name": "key_version",
			"type": "number",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"min": 1, "max": null, "noDecimal": true}
		}`); err != nil {
			return err
		}

		if err := app.Save(collection); err != nil {
			return err
		}

		_, err = app.DB().
			NewQuery("UPDATE conversation_secret_keys SET key_version = {:v} WHERE key_version IS NULL OR key_version = 0").
			Bind(dbx.Params{"v": 1}).
			Execute()
		return err
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversation_secret_keys")
		if err != nil {
			return nil
		}
		collection.Fields.RemoveById("numseckv001")
		return app.Save(collection)
	})
}
