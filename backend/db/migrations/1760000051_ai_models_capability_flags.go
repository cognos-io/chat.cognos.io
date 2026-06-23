package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds capability flags to ai_models so the Requesty sync can capture what each
// model can do (vision, tool calling, web search, computer use). These are
// derived facts kept fresh by the sync — distinct from supports_image_generation,
// which stays curated because it also drives image-transport routing. All default
// false, so the catalogue is unchanged until the sync populates them.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		fields := []string{
			`{"id":"aimodvision01","name":"supports_vision","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`,
			`{"id":"aimodtoolcl01","name":"supports_tool_calling","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`,
			`{"id":"aimodwebsr01","name":"supports_web_search","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`,
			`{"id":"aimodcompu01","name":"supports_computer_use","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`,
		}
		for _, field := range fields {
			if err := addLegacyField(app, collection, field); err != nil {
				return err
			}
		}

		return app.Save(collection)
	}, func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		for _, id := range []string{"aimodvision01", "aimodtoolcl01", "aimodwebsr01", "aimodcompu01"} {
			collection.Fields.RemoveById(id)
		}
		return app.Save(collection)
	})
}
