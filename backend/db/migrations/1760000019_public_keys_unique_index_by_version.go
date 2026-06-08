package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Replace the (conversation) unique index on conversation_public_keys with
// a (conversation, key_version) one so rotation can persist a fresh public
// key per generation. The previous index ('one public_key per conversation
// forever') blocked the rotation handler's insert of a v2 row even when
// the data model conceptually allows it (old rows kept as audit data,
// read-side filtered by current generation).
//
// The narrower index still enforces what the old index was really trying
// to guarantee — that the (conversation, generation) tuple is unique —
// without preventing the rotation flow.
const (
	conversationPublicKeysLegacyUniqueIndex = "CREATE UNIQUE INDEX `idx_conversation_public_keys_conversation_unique` ON `conversation_public_keys` (`conversation`)"
	conversationPublicKeysByVersionIndex    = "CREATE UNIQUE INDEX `idx_conversation_public_keys_conversation_key_version_unique` ON `conversation_public_keys` (`conversation`, `key_version`)"
)

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversation_public_keys")
		if err != nil {
			return err
		}

		collection.Indexes = slices.DeleteFunc(collection.Indexes, func(index string) bool {
			return index == conversationPublicKeysLegacyUniqueIndex
		})
		if !slices.Contains(collection.Indexes, conversationPublicKeysByVersionIndex) {
			collection.Indexes = append(collection.Indexes, conversationPublicKeysByVersionIndex)
		}
		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("conversation_public_keys")
		if err != nil {
			return err
		}

		collection.Indexes = slices.DeleteFunc(collection.Indexes, func(index string) bool {
			return index == conversationPublicKeysByVersionIndex
		})
		if !slices.Contains(collection.Indexes, conversationPublicKeysLegacyUniqueIndex) {
			collection.Indexes = append(collection.Indexes, conversationPublicKeysLegacyUniqueIndex)
		}
		return app.Save(collection)
	})
}
