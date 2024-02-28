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

		collection.ListRule = types.Pointer("@request.auth.id != \"\" &&\n// User is a viewer, editor or admin for the given conversation\n@collection.participants.conversation = conversation &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' || @collection.participants.role = 'Admin') ")

		collection.ViewRule = nil

		collection.CreateRule = types.Pointer("@request.auth.id != \"\" &&\n// User is an editor or admin for the the given conversation\n@collection.participants.conversation = conversation &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Editor' || @collection.participants.role = 'Admin') \n// Check the parent message is also in the same conversation\n(parent_message = \"\" || (parent_message.conversation = conversation))")

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("v893vvhgp688kie")
		if err != nil {
			return err
		}

		collection.ListRule = nil

		collection.ViewRule = types.Pointer("@request.auth.id != \"\" &&\n@collection.participants.conversation = conversation &&\n@collection.participants.user = @request.auth.id &&\n(@collection.participants.role = 'Editor' || @collection.participants.role = 'Admin')")

		collection.CreateRule = nil

		return dao.SaveCollection(collection)
	})
}
