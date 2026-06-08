package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// The participants collection was deleted by 1711007247_deleted_participants.go,
// but the existing PocketBase access rules on conversations / messages /
// conversation_(public|secret)_keys still reference @collection.participants
// — those references currently evaluate against a missing collection, which
// silently falls back to the `creator ?= @request.auth.id` branch. Restoring
// the collection lets us flip access control from "creator only" to
// "participant-based, ready for sharing" without rewriting every rule.
//
// We keep the original collection ID + name so all existing rule strings
// resolve correctly. We add `added_at` / `removed_at` to support participant
// lifecycle (revocation, audit) — `removed_at IS NULL` is the active
// participant filter and is enforced by the in-Go store layer.
//
// The migration also backfills one Admin participant row per existing
// conversation, using the conversation's `creator`. Without backfill,
// every currently-owned conversation would lose access on a rules flip.
func init() {
	m.Register(func(app core.App) error {
		jsonData := `{
			"id": "52et2jthsxn7mjr",
			"name": "participants",
			"type": "base",
			"system": false,
			"fields": [
				{
					"system": false,
					"id": "ba8hv4fd",
					"name": "conversation",
					"type": "relation",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"collectionId": "23wjzzeeb4qilr9",
						"cascadeDelete": true,
						"minSelect": null,
						"maxSelect": 1,
						"displayFields": null
					}
				},
				{
					"system": false,
					"id": "3rnus5de",
					"name": "user",
					"type": "relation",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"collectionId": "_pb_users_auth_",
						"cascadeDelete": true,
						"minSelect": null,
						"maxSelect": 1,
						"displayFields": null
					}
				},
				{
					"system": false,
					"id": "fnjvvx46",
					"name": "role",
					"type": "select",
					"required": true,
					"presentable": false,
					"unique": false,
					"options": {
						"maxSelect": 1,
						"values": ["Viewer", "Editor", "Admin"]
					}
				},
				{
					"system": false,
					"id": "dtaddedat01",
					"name": "added_at",
					"type": "date",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {"min": "", "max": ""}
				},
				{
					"system": false,
					"id": "dtremovedat",
					"name": "removed_at",
					"type": "date",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {"min": "", "max": ""}
				}
			],
			"indexes": [
				"CREATE UNIQUE INDEX ` + "`" + `idx_participants_conv_user` + "`" + ` ON ` + "`" + `participants` + "`" + ` (` + "`" + `conversation` + "`" + `, ` + "`" + `user` + "`" + `)"
			],
			"listRule": null,
			"viewRule": null,
			"createRule": null,
			"updateRule": null,
			"deleteRule": null,
			"options": {}
		}`

		if err := importLegacyCollections(app, jsonData, false); err != nil {
			return err
		}

		return backfillParticipantsFromConversationCreators(app)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("participants")
		if err != nil {
			return nil
		}
		return app.Delete(collection)
	})
}

// backfillParticipantsFromConversationCreators inserts an Admin participant
// row for each existing conversation's creator. The insert is idempotent
// against the (conversation, user) unique index — running the migration a
// second time over already-backfilled rows is a no-op.
func backfillParticipantsFromConversationCreators(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("participants")
	if err != nil {
		return err
	}

	rows := []struct {
		ConversationID string `db:"id"`
		Creator        string `db:"creator"`
	}{}

	if err := app.DB().
		Select("id", "creator").
		From("conversations").
		Where(dbx.NewExp("creator != ''")).
		All(&rows); err != nil {
		return err
	}

	for _, row := range rows {
		existing, err := app.FindFirstRecordByFilter(
			"participants",
			"conversation = {:conversation} && user = {:user}",
			dbx.Params{"conversation": row.ConversationID, "user": row.Creator},
		)
		if err == nil && existing != nil {
			continue
		}

		record := core.NewRecord(collection)
		record.Set("conversation", row.ConversationID)
		record.Set("user", row.Creator)
		record.Set("role", "Admin")
		record.Set("added_at", "")
		if err := app.Save(record); err != nil {
			return err
		}
	}

	return nil
}
