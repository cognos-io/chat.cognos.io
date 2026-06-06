package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

const userKeyPairsUniqueUserIndex = "CREATE UNIQUE INDEX `idx_user_key_pairs_user_unique` ON `user_key_pairs` (`user`)"

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("kx3ewd64kz2os37")
		if err != nil {
			return err
		}

		if !slices.Contains(collection.Indexes, userKeyPairsUniqueUserIndex) {
			collection.Indexes = append(collection.Indexes, userKeyPairsUniqueUserIndex)
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("kx3ewd64kz2os37")
		if err != nil {
			return err
		}

		collection.Indexes = slices.DeleteFunc(collection.Indexes, func(index string) bool {
			return index == userKeyPairsUniqueUserIndex
		})

		return app.Save(collection)
	})
}
