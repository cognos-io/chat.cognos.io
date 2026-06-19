package migrations

import (
	"errors"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Raise the minimum password length to 12. The password is authentication-only
// (the Account Key encrypts data), but a longer minimum still meaningfully
// raises the bar against credential guessing. Only affects newly set/changed
// passwords; existing ones are unaffected until next change.
func setUsersPasswordMin(app core.App, min int) error {
	collection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	field, ok := collection.Fields.GetByName("password").(*core.PasswordField)
	if !ok {
		return errors.New("users.password is not a PasswordField")
	}
	field.Min = min

	return app.Save(collection)
}

func init() {
	m.Register(func(app core.App) error {
		return setUsersPasswordMin(app, 12)
	}, func(app core.App) error {
		return setUsersPasswordMin(app, 8)
	})
}
