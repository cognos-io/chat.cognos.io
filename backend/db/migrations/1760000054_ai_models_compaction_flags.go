package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds compaction-related capability flags to ai_models (spec
// docs/specs/client-side-compaction.md §6.4). Compaction logic reads these
// capabilities and never branches on model IDs, so the feature stays
// provider-agnostic with a defined degraded path when a capability is absent:
//
//   - eligible_for_compaction: model may be used to compact (false for
//     image-only / otherwise unsuitable models). Defaults false so nothing is
//     compacted until a model is explicitly marked eligible.
//   - supports_structured_output: native JSON-schema / forced-tool output. When
//     false, the handler falls back to delimited-text JSON + tolerant parsing.
//   - supports_cache_hints: accepts explicit cache_control breakpoints. When
//     false, we rely on stable-prefix layout / provider auto-cache.
//   - approx_chars_per_token: per-family heuristic for rough draft estimates.
//     0 means "use the global default" so existing rows need no backfill.
func init() {
	m.Register(func(app core.App) error {
		collection, err := app.FindCollectionByNameOrId("ai_models")
		if err != nil {
			return err
		}

		fields := []string{
			`{"id":"aimodcompelig1","name":"eligible_for_compaction","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`,
			`{"id":"aimodstructo01","name":"supports_structured_output","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`,
			`{"id":"aimodcachehnt1","name":"supports_cache_hints","type":"bool","required":false,"presentable":false,"unique":false,"options":{}}`,
			`{"id":"aimodcharptok1","name":"approx_chars_per_token","type":"number","required":false,"presentable":false,"unique":false,"options":{"min":0,"max":null,"noDecimal":false}}`,
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

		for _, id := range []string{"aimodcompelig1", "aimodstructo01", "aimodcachehnt1", "aimodcharptok1"} {
			collection.Fields.RemoveById(id)
		}
		return app.Save(collection)
	})
}
