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

		collection, err := dao.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\"\n&& creator = @request.auth.id")

		collection.ViewRule = types.Pointer("@request.auth.id != \"\" \n&& creator = @request.auth.id")

		collection.CreateRule = types.Pointer("// logged in\n@request.auth.id != \"\" \n// data validation\n&& @request.data.creator = @request.auth.id\n&& @request.data.data:isset = true\n&& @request.data.id:isset = false\n&& @request.data.created:isset = false\n&& @request.data.updated:isset = false")

		collection.DeleteRule = nil

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\" &&\n// User should be a viewer, editor or Admin of the conversations\n(@collection.participants.conversation ?= id &&\n@collection.participants.user ?= @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' ||@collection.participants.role = 'Admin')\n) || (\n  creator ?= @request.auth.id\n)")

		collection.ViewRule = types.Pointer("@request.auth.id != \"\" &&\n// User should be a viewer, editor or Admin of the conversations\n@collection.participants.conversation ?= id &&\n@collection.participants.user ?= @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' ||@collection.participants.role = 'Admin')")

		collection.CreateRule = types.Pointer("// logged in\n@request.auth.id != \"\" \n// data validation\n  && @request.data.creator = @request.auth.id\n  && @request.data.data:isset = true\n&& @request.data.id:isset = false\n&& @request.data.created:isset = false\n&& @request.data.updated:isset = false")

		collection.DeleteRule = types.Pointer("// logged in\n@request.auth.id != \"\" \n&& creator ?= @request.auth.id")

		return dao.SaveCollection(collection)
	})
}
