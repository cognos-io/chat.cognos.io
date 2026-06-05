package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		collection.UpdateRule = types.Pointer("// logged in\n@request.auth.id != \"\" \n// data validation\n&& creator = @request.auth.id")

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		collection.UpdateRule = nil

		return app.Save(collection)
	})
}
