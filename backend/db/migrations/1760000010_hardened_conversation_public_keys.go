package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

const conversationPublicKeysUniqueConversationIndex = "CREATE UNIQUE INDEX `idx_conversation_public_keys_conversation_unique` ON `conversation_public_keys` (`conversation`)"

func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("3v0m8v3xtw1286r")
		if err != nil {
			return err
		}

		collection.CreateRule = types.Pointer("// logged in\n@request.auth.id != \"\"\n// data validation\n&& @request.body.id:isset = false\n&& @request.body.public_key:isset = true\n&& @request.body.public_key_signature:isset = true\n&& @request.body.conversation:isset = true\n&& @request.body.updated:isset = false\n&& @request.body.created:isset = false\n// permissions\n&& conversation.creator = @request.auth.id")
		if !slices.Contains(collection.Indexes, conversationPublicKeysUniqueConversationIndex) {
			collection.Indexes = append(collection.Indexes, conversationPublicKeysUniqueConversationIndex)
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("3v0m8v3xtw1286r")
		if err != nil {
			return err
		}

		collection.CreateRule = types.Pointer("// logged in\n@request.auth.id != \"\"\n// data validation\n&& @request.body.id:isset = false\n&& @request.body.public_key:isset = true\n&& @request.body.conversation:isset = true\n&& @request.body.updated:isset = false\n&& @request.body.created:isset = false\n// permissions\n&& conversation.creator = @request.auth.id")
		collection.Indexes = slices.DeleteFunc(collection.Indexes, func(index string) bool {
			return index == conversationPublicKeysUniqueConversationIndex
		})

		return app.Save(collection)
	})
}
