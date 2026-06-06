package hooks

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func EnforceSingleConversationPublicKey(app core.App) {
	app.OnRecordCreateRequest("conversation_public_keys").BindFunc(func(e *core.RecordRequestEvent) error {
		conversationID := e.Record.GetString("conversation")
		if conversationID == "" {
			return apis.NewBadRequestError("conversation is required", nil)
		}

		records, err := app.FindRecordsByFilter(
			"conversation_public_keys",
			"conversation = {:conversation_id}",
			"",
			1,
			0,
			dbx.Params{"conversation_id": conversationID},
		)
		if err != nil {
			return err
		}
		if len(records) > 0 {
			return apis.NewBadRequestError("conversation public key already exists", nil)
		}

		return e.Next()
	})
}
