package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		jsonData := `[
			{
				"id": "ai_tags_col001",
				"name": "ai_tags",
				"type": "base",
				"system": false,
				"fields": [
					{
						"id": "aitagslug001",
						"name": "slug",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"}
					},
					{
						"id": "aitagtitle01",
						"name": "title",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "aitagcat001",
						"name": "category",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX idx_ai_tags_slug ON ai_tags (slug)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "ai_provider001",
				"name": "ai_providers",
				"type": "base",
				"system": false,
				"fields": [
					{
						"id": "aiprovpid001",
						"name": "provider_id",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"}
					},
					{
						"id": "aiprovname01",
						"name": "name",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "aiprovdesc01",
						"name": "description",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "aiprovenb001",
						"name": "enabled",
						"type": "bool",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {}
					},
					{
						"id": "aiprovrout01",
						"name": "routing_provider_id",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX idx_ai_providers_provider_id ON ai_providers (provider_id)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			},
			{
				"id": "ai_models_col01",
				"name": "ai_models",
				"type": "base",
				"system": false,
				"fields": [
					{
						"id": "aimodmid001",
						"name": "model_id",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"}
					},
					{
						"id": "aimodprov01",
						"name": "provider",
						"type": "relation",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "ai_provider001",
							"cascadeDelete": false,
							"minSelect": null,
							"maxSelect": 1,
							"displayFields": ["name"]
						}
					},
					{
						"id": "aimodpmod01",
						"name": "provider_model_id",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "aimodname001",
						"name": "name",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "aimodslug001",
						"name": "slug",
						"type": "text",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"}
					},
					{
						"id": "aimoddesc001",
						"name": "description",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "aimodenab001",
						"name": "enabled",
						"type": "bool",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {}
					},
					{
						"id": "aimodwhite01",
						"name": "whitelisted",
						"type": "bool",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {}
					},
					{
						"id": "aimodpriv001",
						"name": "privacy_tier",
						"type": "select",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {
							"maxSelect": 1,
							"values": ["ch_only", "eu", "global"]
						}
					},
					{
						"id": "aimodhostcty1",
						"name": "hosting_country",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "aimodhostrg1",
						"name": "hosting_region",
						"type": "text",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": null, "max": null, "pattern": ""}
					},
					{
						"id": "aimodnoret01",
						"name": "no_retention",
						"type": "bool",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {}
					},
					{
						"id": "aimodos001",
						"name": "is_open_source",
						"type": "bool",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {}
					},
					{
						"id": "aimodctx001",
						"name": "input_context_tokens",
						"type": "number",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": 1, "max": null, "noDecimal": true}
					},
					{
						"id": "aimodmax001",
						"name": "max_output_tokens",
						"type": "number",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {"min": 1, "max": null, "noDecimal": true}
					},
					{
						"id": "aimodin001",
						"name": "input_usd_per_million_tokens",
						"type": "number",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": false}
					},
					{
						"id": "aimodout001",
						"name": "output_usd_per_million_tokens",
						"type": "number",
						"required": true,
						"presentable": false,
						"unique": false,
						"options": {"min": 0, "max": null, "noDecimal": false}
					},
					{
						"id": "aimodtags001",
						"name": "tags",
						"type": "relation",
						"required": false,
						"presentable": false,
						"unique": false,
						"options": {
							"collectionId": "ai_tags_col001",
							"cascadeDelete": false,
							"minSelect": null,
							"maxSelect": null,
							"displayFields": ["title"]
						}
					}
				],
				"indexes": [
					"CREATE UNIQUE INDEX idx_ai_models_model_id ON ai_models (model_id)",
					"CREATE UNIQUE INDEX idx_ai_models_slug ON ai_models (slug)"
				],
				"listRule": null,
				"viewRule": null,
				"createRule": null,
				"updateRule": null,
				"deleteRule": null,
				"options": {}
			}
		]`

		if err := importLegacyCollections(app, jsonData, false); err != nil {
			return err
		}

		return seedDefaultAICatalogue(app)
	}, func(app core.App) error {
		for _, name := range []string{"ai_models", "ai_providers", "ai_tags"} {
			collection, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				continue
			}
			if err := app.Delete(collection); err != nil {
				return err
			}
		}
		return nil
	})
}

func seedDefaultAICatalogue(app core.App) error {
	generalPurposeTag, err := findOrCreateRecord(app, "ai_tags", "slug", "general-purpose", map[string]any{
		"title":    "general-purpose",
		"category": "capability",
	})
	if err != nil {
		return err
	}

	switzerlandTag, err := findOrCreateRecord(app, "ai_tags", "slug", "switzerland", map[string]any{
		"title":    "switzerland",
		"category": "residency",
	})
	if err != nil {
		return err
	}

	provider, err := findOrCreateRecord(app, "ai_providers", "provider_id", "infomaniak", map[string]any{
		"name":                "Infomaniak",
		"description":         "Infomaniak hosts privacy-focused AI infrastructure in Switzerland.",
		"enabled":             true,
		"routing_provider_id": "infomaniak",
	})
	if err != nil {
		return err
	}

	_, err = findOrCreateRecord(app, "ai_models", "model_id", "llama-3-3-infomaniak", map[string]any{
		"provider":                      provider.Id,
		"provider_model_id":             "llama-3.3-70b-instruct",
		"name":                          "Llama 3.3",
		"slug":                          "llama-3-3-infomaniak",
		"description":                   "Meta's Llama 3.3 model, hosted in Switzerland by Infomaniak with no data retention.",
		"enabled":                       true,
		"whitelisted":                   true,
		"privacy_tier":                  "ch_only",
		"hosting_country":               "CH",
		"hosting_region":                "switzerland",
		"no_retention":                  true,
		"is_open_source":                true,
		"input_context_tokens":          128000,
		"max_output_tokens":             8192,
		"input_usd_per_million_tokens":  1,
		"output_usd_per_million_tokens": 2,
		"tags":                          []string{generalPurposeTag.Id, switzerlandTag.Id},
	})
	return err
}

func findOrCreateRecord(app core.App, collectionName string, key string, value any, fields map[string]any) (*core.Record, error) {
	record, err := app.FindFirstRecordByData(collectionName, key, value)
	if err == nil {
		return record, nil
	}

	collection, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		return nil, err
	}

	record = core.NewRecord(collection)
	record.Set(key, value)
	for field, fieldValue := range fields {
		record.Set(field, fieldValue)
	}

	if err := app.Save(record); err != nil {
		return nil, err
	}

	return record, nil
}
