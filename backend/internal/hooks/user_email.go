package hooks

import (
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func ForbidUserEmailChanges(app core.App) {
	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record.Original().Email() != e.Record.Email() {
			return apis.NewBadRequestError("email changes are not allowed", nil)
		}

		return e.Next()
	})
}
