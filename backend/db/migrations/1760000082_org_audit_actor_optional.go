package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Makes org_audit_events.actor optional so Account deletion can detach
// content-free audit rows instead of failing when the leaving member was an
// actor (e.g. org.invite.accepted). Rows are retained; only the actor link is
// cleared — the same pattern as financial user_id detachment.
func init() {
	m.Register(func(app core.App) error {
		return setOrgAuditActorRequired(app, false)
	}, func(app core.App) error {
		return setOrgAuditActorRequired(app, true)
	})
}

func setOrgAuditActorRequired(app core.App, required bool) error {
	collection, err := app.FindCollectionByNameOrId("org_audit_events")
	if err != nil {
		return err
	}
	field, ok := collection.Fields.GetByName("actor").(*core.RelationField)
	if !ok {
		return fmt.Errorf("org_audit_events.actor is not a relation field")
	}
	field.Required = required
	return app.Save(collection)
}
