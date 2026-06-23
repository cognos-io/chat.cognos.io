package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds per-model reasoning-effort metadata to ai_models. reasoning_efforts is
// the ordered list of effort tiers a model accepts (e.g. ["off","low",
// "medium","high"], or model-specific tiers like "ultra"); default_reasoning_effort
// is the tier preselected in the composer. Both are empty by default — a model
// only shows the effort selector once it declares a non-empty list, so this
// migration ships the capability dormant. Enabling a specific model is a
// one-line data change (set the two fields on its record) once the provider's
// accepted tiers are confirmed.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"id": "aimodrsneff01",
			"name": "reasoning_efforts",
			"type": "json",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"maxSize": 2000000}
		}`); err != nil {
			return err
		}

		if err := addLegacyField(app, collection, `{
			"id": "aimodrsndef01",
			"name": "default_reasoning_effort",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {"min": null, "max": null, "pattern": ""}
		}`); err != nil {
			return err
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		collection.Fields.RemoveById("aimodrsneff01")
		collection.Fields.RemoveById("aimodrsndef01")
		return app.Save(collection)
	})
}
