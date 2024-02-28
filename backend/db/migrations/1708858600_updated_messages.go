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

		collection, err := dao.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.ViewRule = types.Pointer("@request.auth.id != \"\" &&\n@collection.participants.conversation = conversation &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Editor' || @collection.participants.role = 'Admin')")

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.ViewRule = nil

		return dao.SaveCollection(collection)
	})
}
