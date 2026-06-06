package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("_pb_users_auth_")
		if err != nil {
			return err
		}

		collection.PasswordAuth.Enabled = true
		collection.PasswordAuth.IdentityFields = []string{"email"}
		collection.OAuth2.Enabled = false
		collection.OAuth2.Providers = nil

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("_pb_users_auth_")
		if err != nil {
			return err
		}

		collection.OAuth2.Enabled = true

		return app.Save(collection)
	})
}
