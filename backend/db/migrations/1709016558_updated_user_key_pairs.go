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

		collection, err := dao.FindCollectionByNameOrId("kx3ewd64kz2os37")
		if err != nil {
			return err
		}

		collection.CreateRule = types.Pointer(
			"@request.auth.id != \"\" && \n@request.auth.id = @request.data.user &&\n// Additional validation\n@request.data.id:isset = false &&\n@request.data.created:isset = false &&\n@request.data.updated:isset = false &&\n@request.data.public_key:isset = true &&\n@request.data.secret_key:isset = true",
		)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("kx3ewd64kz2os37")
		if err != nil {
			return err
		}

		collection.CreateRule = types.Pointer(
			"@request.auth.id != \"\" && \n@request.auth.id = @request.data.user",
		)

		return dao.SaveCollection(collection)
	})
}
