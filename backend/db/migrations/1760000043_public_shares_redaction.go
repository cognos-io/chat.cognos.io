package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Add public-share modes for PII redaction (spec §6.6, §11.5).
//
//   - mode: "redacted_only" (default) or "include_sensitive". A redacted-only
//     share hands the reader only the conversation key, so placeholders stay
//     placeholders. An include-sensitive share additionally carries the
//     redaction key material below.
//   - wrapped_redaction_secret_key: the conversation's redaction SECRET key
//     sealed to the share's public key, so an anonymous reader holding the URL
//     fragment can recover it (mirrors wrapped_conversation_secret_key).
//   - redaction_public_key: the redaction public key for that generation, so the
//     reader can rebuild the keypair and open the sealed mapping entries.
//
// Both redaction fields are optional and only populated for include-sensitive
// shares; redacted-only shares leave them empty and the public endpoints never
// return redaction data for them.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversation_public_shares")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "cpsmode000001",
			"name": "mode",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"min": 0, "max": 32, "pattern": "^(redacted_only|include_sensitive)$"}
		}`); err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "cpswrapred001",
			"name": "wrapped_redaction_secret_key",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"min": 0, "max": 1024, "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"}
		}`); err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "cpsredpub0001",
			"name": "redaction_public_key",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"min": 0, "max": 1024, "pattern": "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"}
		}`); err != nil {
			return err
		}

		if err := app.Save(collection); err != nil {
			return err
		}

		// Existing shares predate modes; treat them as redacted-only.
		_, err = app.DB().
			NewQuery("UPDATE conversation_public_shares SET mode = {:m} WHERE mode IS NULL OR mode = ''").
			Bind(dbx.Params{"m": "redacted_only"}).
			Execute()
		return err
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversation_public_shares")
		if err != nil {
			return nil
		}
		collection.Fields.RemoveById("cpsmode000001")
		collection.Fields.RemoveById("cpswrapred001")
		collection.Fields.RemoveById("cpsredpub0001")
		return app.Save(collection)
	})
}
