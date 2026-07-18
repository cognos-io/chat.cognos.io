package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// rotation_pending is a fail-closed security lock for Project writes. An
// offboarded Participant may retain an old Project key, so the backend marks
// every affected Project pending in the same transaction as access revocation.
// Only a complete forward-only key rotation clears the lock.
//
// This is expand-only: deployed code may depend on the lock, so rollback must
// never remove the field.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{"id":"projrotpend001","name":"rotation_pending","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`); err != nil {
			return err
		}
		return app.Save(collection)
	}, nil)
}
