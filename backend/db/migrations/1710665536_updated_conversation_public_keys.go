package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("3v0m8v3xtw1286r")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("// logged in\n@request.auth.id != \"\"\n// permissions\n&& conversation.creator = @request.auth.id")

		collection.CreateRule = types.Pointer("// logged in\n@request.auth.id != \"\"\n// data validation\n&& @request.body.id:isset = false\n&& @request.body.public_key:isset = true\n&& @request.body.conversation:isset = true\n&& @request.body.updated:isset = false\n&& @request.body.created:isset = false\n// permissions\n&& conversation.creator = @request.auth.id")

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("3v0m8v3xtw1286r")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("// logged in\n@request.auth.id != \"\"\n// permissions\n&& (\n  @collection.participants.conversation ?= conversation\n  && @collection.participants.user ?= @request.auth.id \n  && (\n    @collection.participants.role = 'Viewer'\n    || @collection.participants.role = 'Editor'\n    ||@collection.participants.role = 'Admin'\n  )\n) || (\n  conversation.creator ?= @request.auth.id\n)")

		collection.CreateRule = types.Pointer("// logged in\n@request.auth.id != \"\"\n// data validation\n&& @request.body.id:isset = false\n&& @request.body.public_key:isset = true\n&& @request.body.conversation:isset = true\n&& @request.body.updated:isset = false\n&& @request.body.created:isset = false\n// permissions\n&& (\n  (@collection.participants.conversation ?= @request.body.conversation\n    && @collection.participants.user ?= @request.auth.id \n    && @collection.participants.role = 'Admin' // only admins can add keys)\n  ||\n  (@collection.conversations.id ?= @request.body.conversation\n    && @collection.conversations.creator ?= @request.auth.id // creators can also add keys)\n  )")

		return app.Save(collection)
	})
}
