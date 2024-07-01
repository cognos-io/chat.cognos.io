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

		collection.UpdateRule = types.Pointer("@request.auth.id != \"\"\n&& conversation.creator = @request.auth.id\n&& @request.data.data:isset = true\n&& @request.data.id:isset = false\n&& @request.data.created:isset = false\n&& @request.data.updated:isset = false\n&& @request.data.conversation:isset = false\n&& @request.data.parent_message:isset = false")

		collection.DeleteRule = nil

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.UpdateRule = nil

		collection.DeleteRule = types.Pointer("@request.auth.id != \"\" \n&& conversation.creator = @request.auth.id")

		return dao.SaveCollection(collection)
	})
}
