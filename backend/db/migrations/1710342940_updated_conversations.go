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

		collection.CreateRule = types.Pointer("// logged in\n@request.auth.id != \"\" \n// data validation\n  && @request.data.creator = @request.auth.id\n  && @request.data.data:isset = true\n&& @request.data.id:isset = false\n&& @request.data.created:isset = false\n&& @request.data.updated:isset = false")

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		collection.CreateRule = nil

		return dao.SaveCollection(collection)
	})
}
