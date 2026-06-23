package migrations

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Add an explicit conversation activity timestamp for sidebar ordering.
//
// `updated` remains PocketBase's generic row timestamp. `last_activity_at` means
// user-visible conversation activity: message created, message content changed,
// message deleted, or conversation title changed. Metadata-only changes (for
// example keeping an expiring message) should not move a chat in the sidebar.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversations")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"system": false,
			"id": "convlastact01",
			"name": "last_activity_at",
			"type": "date",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": "",
				"max": ""
			}
		}`); err != nil {
			return err
		}

		if err := app.Save(collection); err != nil {
			return err
		}

		records, err := app.FindAllRecords(collection)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		for _, record := range records {
			if record.GetString("last_activity_at") != "" {
				continue
			}
			activityAt := record.GetString("updated")
			if activityAt == "" {
				activityAt = record.GetString("created")
			}
			if activityAt == "" {
				record.Set("last_activity_at", now)
			} else {
				record.Set("last_activity_at", activityAt)
			}
			if err := app.Save(record); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversations")
		if err != nil {
			return nil
		}
		collection.Fields.RemoveById("convlastact01")
		return app.Save(collection)
	})
}
