package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\" \n&& conversation = @request.data.conversation\n&& conversation.creator = @request.auth.id")

		collection.CreateRule = nil

		collection.DeleteRule = types.Pointer("@request.auth.id != \"\" \n&& id = @request.data.id\n&& conversation.creator = @request.auth.id")

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\" \n&& conversation.creator = @request.auth.id")

		collection.CreateRule = types.Pointer("@request.auth.id != \"\"\n&& conversation.creator = @request.auth.id\n&& (parent_message = \"\" || (parent_message.conversation = conversation))")

		collection.DeleteRule = types.Pointer("@request.auth.id != \"\" \n&& conversation.creator = @request.auth.id")

		return dao.SaveCollection(collection)
	})
}
