package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("zy560w1blembu8s")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("// logged in\n@request.auth.id != \"\"\n// permissions\n&& user = @request.auth.id\n&& conversation.creator = @request.auth.id")

		collection.CreateRule = types.Pointer("// logged in\n@request.auth.id != \"\"\n// data validation\n&& @request.data.id:isset = false\n&& @request.data.secret_key:isset = true\n&& @request.data.conversation:isset = true\n&& @request.data.updated:isset = false\n&& @request.data.created:isset = false\n&& @request.data.user = @request.auth.id\n// permissions\n&& conversation.creator = @request.auth.id")

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("zy560w1blembu8s")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("// logged in\n@request.auth.id != \"\"\n// permissions\n&& user = @request.auth.id\n&& (\n  @collection.participants.conversation ?= conversation\n  && @collection.participants.user ?= @request.auth.id \n  && (\n    @collection.participants.role = 'Viewer'\n    || @collection.participants.role = 'Editor'\n    ||@collection.participants.role = 'Admin'\n  )\n) || (\n  conversation.creator ?= @request.auth.id\n)")

		collection.CreateRule = types.Pointer("// logged in\n@request.auth.id != \"\"\n// data validation\n&& @request.data.id:isset = false\n&& @request.data.secret_key:isset = true\n&& @request.data.conversation:isset = true\n&& @request.data.updated:isset = false\n&& @request.data.created:isset = false\n&& @request.data.user = @request.auth.id\n// permissions\n&& (\n  (@collection.participants.conversation ?= @request.data.conversation\n    && @collection.participants.user ?= @request.auth.id \n    && @collection.participants.role = 'Admin' // only admins can add keys)\n  ||\n  (@collection.conversations.id ?= @request.data.conversation\n    && @collection.conversations.creator ?= @request.auth.id // creators can also add keys)\n  )")

		return dao.SaveCollection(collection)
	})
}
