package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Raises the character limit on messages.data. The field stores the base64
// encoded, encrypted message body, but its max was left at 0 — and PocketBase
// treats a zero max on a text field as a default cap of 5000 characters. That
// default silently rejected any long message (e.g. a lengthy assistant
// response) with "Must be no more than 5000 character(s)." and failed the
// /conversations/{id}/complete save.
//
// 1 MB matches the existing conversations.data limit (migration
// 1718963866_updated_conversations.go), which holds the same kind of encrypted
// payload.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("messages")
		if err != nil {
			return err
		}
		field, ok := collection.Fields.GetByName("data").(*core.TextField)
		if !ok {
			return fmt.Errorf("data is not a text field")
		}
		field.Max = 1048576
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("messages")
		if err != nil {
			return err
		}
		field, ok := collection.Fields.GetByName("data").(*core.TextField)
		if !ok {
			return fmt.Errorf("data is not a text field")
		}
		field.Max = 0
		return app.Save(collection)
	})
}
