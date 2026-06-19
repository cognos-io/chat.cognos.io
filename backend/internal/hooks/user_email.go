package hooks

import (
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Email changes must go through PocketBase's verified request → confirm flow
// (a confirmation link is sent to the new address). That flow saves via the
// model layer rather than this request hook, so it is unaffected; this only
// blocks an unverified email swap via a direct record PATCH.
func ForbidUserEmailChanges(app core.App) {
	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Record.Original().Email() != e.Record.Email() {
			return apis.NewBadRequestError("Email changes must go through email verification.", nil)
		}

		return e.Next()
	})
}
