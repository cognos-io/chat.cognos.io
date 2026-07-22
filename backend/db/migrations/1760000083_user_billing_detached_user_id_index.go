package migrations

import (
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Account deletion detaches user_billing by nulling user_id. A full UNIQUE
// index on user_id then rejects every second deletion because multiple rows
// share the empty value. Replace it with a partial unique index that only
// covers attached (non-empty) user_ids — one billing row per live Account,
// many detached historical rows allowed.
const (
	userBillingUserIDUniqueIndex = "CREATE UNIQUE INDEX idx_user_billing_user_id ON user_billing (user_id)"
	userBillingUserIDPartialUniqueIndex = "CREATE UNIQUE INDEX `idx_user_billing_user_id` ON `user_billing` (`user_id`) WHERE `user_id` IS NOT NULL AND `user_id` != ''"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("user_billing")
		if err != nil {
			return err
		}
		collection.Indexes = slices.DeleteFunc(collection.Indexes, func(index string) bool {
			return strings.Contains(index, "idx_user_billing_user_id")
		})
		if !slices.Contains(collection.Indexes, userBillingUserIDPartialUniqueIndex) {
			collection.Indexes = append(collection.Indexes, userBillingUserIDPartialUniqueIndex)
		}
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("user_billing")
		if err != nil {
			return err
		}
		collection.Indexes = slices.DeleteFunc(collection.Indexes, func(index string) bool {
			return strings.Contains(index, "idx_user_billing_user_id")
		})
		if !slices.Contains(collection.Indexes, userBillingUserIDUniqueIndex) {
			collection.Indexes = append(collection.Indexes, userBillingUserIDUniqueIndex)
		}
		return app.Save(collection)
	})
}
