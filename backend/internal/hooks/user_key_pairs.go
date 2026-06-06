package hooks

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func EnforceSingleUserKeyPair(app core.App) {
	app.OnRecordCreateRequest("user_key_pairs").BindFunc(func(e *core.RecordRequestEvent) error {
		userID := e.Record.GetString("user")
		if userID == "" {
			return apis.NewBadRequestError("user is required", nil)
		}

		records, err := app.FindRecordsByFilter(
			"user_key_pairs",
			"user = {:user_id}",
			"",
			1,
			0,
			dbx.Params{"user_id": userID},
		)
		if err != nil {
			return err
		}
		if len(records) > 0 {
			return apis.NewBadRequestError("user key pair already exists", nil)
		}

		return e.Next()
	})
}
