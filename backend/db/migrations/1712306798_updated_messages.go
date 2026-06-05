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

		collection.ListRule = types.Pointer("@request.auth.id != \"\" \n&& conversation = @request.body.conversation\n&& conversation.creator = @request.auth.id")

		collection.CreateRule = nil

		collection.DeleteRule = types.Pointer("@request.auth.id != \"\" \n&& id = @request.body.id\n&& conversation.creator = @request.auth.id")

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\" \n&& conversation.creator = @request.auth.id")

		collection.CreateRule = types.Pointer("@request.auth.id != \"\"\n&& conversation.creator = @request.auth.id\n&& (parent_message = \"\" || (parent_message.conversation = conversation))")

		collection.DeleteRule = types.Pointer("@request.auth.id != \"\" \n&& conversation.creator = @request.auth.id")

		return app.Save(collection)
	})
}
