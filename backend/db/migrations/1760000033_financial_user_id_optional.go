package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Makes the user_id relation optional on the financial collections so deleting
// a user account detaches (nulls) these rows instead of blocking on the
// required-relation validation. The financial records are retained for
// accounting; they simply lose their link to the now-deleted user. New rows are
// still always written with a user_id by the billing code — only deletion ever
// leaves it empty.
var financialUserIDCollections = []string{
	"user_billing",
	"balance_transactions",
	"refunds",
	"payg_cycle_summaries",
}

func init() {
	m.Register(func(app core.App) error {
		return setFinancialUserIDRequired(app, false)
	}, func(app core.App) error {
		return setFinancialUserIDRequired(app, true)
	})
}

func setFinancialUserIDRequired(app core.App, required bool) error {
	for _, name := range financialUserIDCollections {
		collection, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return err
		}
		field, ok := collection.Fields.GetByName("user_id").(*core.RelationField)
		if !ok {
			return fmt.Errorf("%s.user_id is not a relation field", name)
		}
		field.Required = required
		if err := app.Save(collection); err != nil {
			return err
		}
	}
	return nil
}
