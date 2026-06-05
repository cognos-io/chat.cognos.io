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

		collection.ListRule = types.Pointer("@request.auth.id != \"\"\n&& creator = @request.auth.id")

		collection.ViewRule = types.Pointer("@request.auth.id != \"\" \n&& creator = @request.auth.id")

		collection.CreateRule = types.Pointer("// logged in\n@request.auth.id != \"\" \n// data validation\n&& @request.body.creator = @request.auth.id\n&& @request.body.data:isset = true\n&& @request.body.id:isset = false\n&& @request.body.created:isset = false\n&& @request.body.updated:isset = false")

		collection.DeleteRule = nil

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("23wjzzeeb4qilr9")
		if err != nil {
			return err
		}

		collection.ListRule = types.Pointer("@request.auth.id != \"\" &&\n// User should be a viewer, editor or Admin of the conversations\n(@collection.participants.conversation ?= id &&\n@collection.participants.user ?= @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' ||@collection.participants.role = 'Admin')\n) || (\n  creator ?= @request.auth.id\n)")

		collection.ViewRule = types.Pointer("@request.auth.id != \"\" &&\n// User should be a viewer, editor or Admin of the conversations\n@collection.participants.conversation ?= id &&\n@collection.participants.user ?= @request.auth.id &&\n(@collection.participants.role = 'Viewer' || @collection.participants.role = 'Editor' ||@collection.participants.role = 'Admin')")

		collection.CreateRule = types.Pointer("// logged in\n@request.auth.id != \"\" \n// data validation\n  && @request.body.creator = @request.auth.id\n  && @request.body.data:isset = true\n&& @request.body.id:isset = false\n&& @request.body.created:isset = false\n&& @request.body.updated:isset = false")

		collection.DeleteRule = types.Pointer("// logged in\n@request.auth.id != \"\" \n&& creator ?= @request.auth.id")

		return app.Save(collection)
	})
}
