package hooks

import (
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const emailChangeUnavailableMessage = "email changes are unavailable until account key re-auth is implemented"

func ForbidUserEmailChangeFlow(app core.App) {
	app.OnRecordRequestEmailChangeRequest("users").BindFunc(func(e *core.RecordRequestEmailChangeRequestEvent) error {
		return apis.NewBadRequestError(emailChangeUnavailableMessage, nil)
	})

	app.OnRecordConfirmEmailChangeRequest("users").BindFunc(func(e *core.RecordConfirmEmailChangeRequestEvent) error {
		return apis.NewBadRequestError(emailChangeUnavailableMessage, nil)
	})
}
