package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Complete the key_version trio. With conversation_public_keys.key_version
// in place alongside the existing fields on conversations and
// conversation_secret_keys, every artefact in the encryption envelope can
// be tied back to the conversation generation it was produced under:
//
//   - conversations.key_version          → the current generation
//   - conversation_public_keys.key_version → the wrapping pubkey for that gen
//   - conversation_secret_keys.key_version → each participant's wrapped key
//
// Rotation can then re-issue the public key + per-participant wrapped
// secret keys at the new generation, leaving older rows in place as audit
// data and filterable as stale.
//
// As with the other key_version migrations this only adds the column with
// a default of 1 and backfills existing rows. Read-side filtering by the
// conversation's current generation lands with the rotation slice.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversation_public_keys")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "numpubkv001",
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
			NewQuery("UPDATE conversation_public_keys SET key_version = {:v} WHERE key_version IS NULL OR key_version = 0").
			Bind(dbx.Params{"v": 1}).
			Execute()
		return err
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversation_public_keys")
		if err != nil {
			return nil
		}
		collection.Fields.RemoveById("numpubkv001")
		return app.Save(collection)
	})
}
