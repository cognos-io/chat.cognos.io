package hooks

import (
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const passwordResetUnavailableMessage = "password reset is unavailable until vault recovery is implemented"

func ForbidPasswordReset(app core.App) {
	app.OnRecordRequestPasswordResetRequest("users").BindFunc(func(e *core.RecordRequestPasswordResetRequestEvent) error {
		return apis.NewBadRequestError(passwordResetUnavailableMessage, nil)
	})

	app.OnRecordConfirmPasswordResetRequest("users").BindFunc(func(e *core.RecordConfirmPasswordResetRequestEvent) error {
		return apis.NewBadRequestError(passwordResetUnavailableMessage, nil)
	})
}
