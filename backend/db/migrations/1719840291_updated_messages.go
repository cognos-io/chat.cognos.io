package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.UpdateRule = types.Pointer("@request.auth.id != \"\" \n&& conversation.creator = @request.auth.id\n// Data validation\n&& @request.body.id:isset = false\n&& @request.body.data:isset = false\n&& @request.body.conversation:isset = false\n&& @request.body.parent_message:isset = false\n&& @request.body.created:isset = false\n&& @request.body.updated:isset = false\n// Expires can be set or unset")

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.UpdateRule = nil

		return app.Save(collection)
	})
}
