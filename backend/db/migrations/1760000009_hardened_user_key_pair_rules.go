package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("user_key_pairs")
		if err != nil {
			return err
		}

		collection.CreateRule = types.Pointer("@request.auth.id != \"\" && \n@request.auth.id = @request.body.user &&\n// Additional validation\n@request.body.id:isset = false &&\n@request.body.created:isset = false &&\n@request.body.updated:isset = false &&\n@request.body.public_key:isset = true &&\n@request.body.secret_key:isset = true &&\n@request.body.password_salt:isset = true &&\n@request.body.unlock_scheme:isset = true &&\n@request.body.unlock_scheme = \"password_account_key_v1\" &&\n@request.body.record_mac:isset = true")
		collection.UpdateRule = types.Pointer("@request.auth.id != \"\" &&\n@request.auth.id = user.id &&\n@request.body.id:isset = false &&\n@request.body.created:isset = false &&\n@request.body.updated:isset = false &&\n@request.body.user:isset = false &&\n@request.body.public_key:isset = false &&\n@request.body.secret_key:isset = false &&\n@request.body.password_salt:isset = false &&\n@request.body.unlock_scheme:isset = false &&\n@request.body.record_mac:isset = true")

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("user_key_pairs")
		if err != nil {
			return err
		}

		collection.CreateRule = types.Pointer("@request.auth.id != \"\" && \n@request.auth.id = @request.body.user &&\n// Additional validation\n@request.body.id:isset = false &&\n@request.body.created:isset = false &&\n@request.body.updated:isset = false &&\n@request.body.public_key:isset = true &&\n@request.body.secret_key:isset = true")
		collection.UpdateRule = types.Pointer("@request.auth.id != \"\" &&\n@request.auth.id = user.id &&\n@request.body.id:isset = false &&\n@request.body.created:isset = false &&\n@request.body.updated:isset = false &&\n@request.body.user:isset = false &&\n@request.body.public_key:isset = false &&\n@request.body.secret_key:isset = false &&\n@request.body.record_mac:isset = true")

		return app.Save(collection)
	})
}
