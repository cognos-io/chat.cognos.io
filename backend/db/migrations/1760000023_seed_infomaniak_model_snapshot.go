package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

type infomaniakModelSeed struct {
	modelID                   string
	providerModelID           string
	name                      string
	description               string
	enabled                   bool
	whitelisted               bool
	isOpenSource              bool
	inputContextTokens        int
	maxOutputTokens           int
	inputUSDPerMillionTokens  float64
	outputUSDPerMillionTokens float64
	tagSlugs                  []string
}

func init() {
	m.Register(func(app core.App) error {
		provider, err := findOrCreateRecord(app, "ai_providers", "provider_id", "infomaniak", map[string]any{
			"name":                "Infomaniak",
			"description":         "Infomaniak hosts privacy-focused AI infrastructure in Switzerland.",
			"enabled":             true,
			"routing_provider_id": "infomaniak",
		})
		if err != nil {
			return err
		}

		tagsBySlug := map[string]string{}
		for _, tag := range []struct {
			slug     string
			title    string
			category string
		}{
			{slug: "general-purpose", title: "general-purpose", category: "capability"},
			{slug: "embedding", title: "embedding", category: "capability"},
			{slug: "switzerland", title: "switzerland", category: "residency"},
		} {
			record, err := findOrCreateRecord(app, "ai_tags", "slug", tag.slug, map[string]any{
				"title":    tag.title,
				"category": tag.category,
			})
			if err != nil {
				return err
			}
			tagsBySlug[tag.slug] = record.Id
		}

		for _, model := range []infomaniakModelSeed{
			{
				modelID:            "bge-multilingual-gemma2-infomaniak",
				providerModelID:    "bge_multilingual_gemma2",
				name:               "BGE Multilingual Gemma 2",
				description:        "Embedding model hosted in Switzerland by Infomaniak with no data retention.",
				enabled:            false,
				whitelisted:        false,
				inputContextTokens: 8192,
				tagSlugs:           []string{"embedding", "switzerland"},
			},
			{
				modelID:            "mini-lm-l12-v2-infomaniak",
				providerModelID:    "mini_lm_l12_v2",
				name:               "MiniLM L12 v2",
				description:        "Embedding model hosted in Switzerland by Infomaniak with no data retention.",
				enabled:            false,
				whitelisted:        false,
				inputContextTokens: 8192,
				tagSlugs:           []string{"embedding", "switzerland"},
			},
			{
				modelID:                   "swiss-ai-apertus-70b-instruct-2509-infomaniak",
				providerModelID:           "swiss-ai/Apertus-70B-Instruct-2509",
				name:                      "Apertus 70B Instruct 2509",
				description:               "Instruction model hosted in Switzerland by Infomaniak with no data retention.",
				enabled:                   true,
				whitelisted:               true,
				isOpenSource:              true,
				inputContextTokens:        128000,
				maxOutputTokens:           8192,
				inputUSDPerMillionTokens:  0,
				outputUSDPerMillionTokens: 0,
				tagSlugs:                  []string{"general-purpose", "switzerland"},
			},
			{
				modelID:            "qwen-qwen3-embedding-8b-infomaniak",
				providerModelID:    "Qwen/Qwen3-Embedding-8B",
				name:               "Qwen3 Embedding 8B",
				description:        "Embedding model hosted in Switzerland by Infomaniak with no data retention.",
				enabled:            false,
				whitelisted:        false,
				isOpenSource:       true,
				inputContextTokens: 8192,
				tagSlugs:           []string{"embedding", "switzerland"},
			},
			{
				modelID:                   "mistralai-ministral-3-14b-instruct-2512-infomaniak",
				providerModelID:           "mistralai/Ministral-3-14B-Instruct-2512",
				name:                      "Ministral 3 14B Instruct 2512",
				description:               "Instruction model hosted in Switzerland by Infomaniak with no data retention.",
				enabled:                   true,
				whitelisted:               true,
				inputContextTokens:        128000,
				maxOutputTokens:           8192,
				inputUSDPerMillionTokens:  0,
				outputUSDPerMillionTokens: 0,
				tagSlugs:                  []string{"general-purpose", "switzerland"},
			},
			{
				modelID:                   "qwen-qwen3-5-122b-a10b-fp8-infomaniak",
				providerModelID:           "Qwen/Qwen3.5-122B-A10B-FP8",
				name:                      "Qwen3.5 122B A10B FP8",
				description:               "General-purpose model hosted in Switzerland by Infomaniak with no data retention.",
				enabled:                   true,
				whitelisted:               true,
				isOpenSource:              true,
				inputContextTokens:        128000,
				maxOutputTokens:           8192,
				inputUSDPerMillionTokens:  0,
				outputUSDPerMillionTokens: 0,
				tagSlugs:                  []string{"general-purpose", "switzerland"},
			},
			{
				modelID:                   "google-gemma-4-31b-it-infomaniak",
				providerModelID:           "google/gemma-4-31B-it",
				name:                      "Gemma 4 31B IT",
				description:               "Instruction model hosted in Switzerland by Infomaniak with no data retention.",
				enabled:                   true,
				whitelisted:               true,
				isOpenSource:              true,
				inputContextTokens:        128000,
				maxOutputTokens:           8192,
				inputUSDPerMillionTokens:  0,
				outputUSDPerMillionTokens: 0,
				tagSlugs:                  []string{"general-purpose", "switzerland"},
			},
			{
				modelID:                   "moonshotai-kimi-k2-6-infomaniak",
				providerModelID:           "moonshotai/Kimi-K2.6",
				name:                      "Kimi K2.6",
				description:               "General-purpose model hosted in Switzerland by Infomaniak with no data retention.",
				enabled:                   true,
				whitelisted:               true,
				inputContextTokens:        128000,
				maxOutputTokens:           8192,
				inputUSDPerMillionTokens:  0,
				outputUSDPerMillionTokens: 0,
				tagSlugs:                  []string{"general-purpose", "switzerland"},
			},
			{
				modelID:                   "nvidia-nemotron-3-nano-30b-a3b-fp8-infomaniak",
				providerModelID:           "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8",
				name:                      "NVIDIA Nemotron 3 Nano 30B A3B FP8",
				description:               "General-purpose model hosted in Switzerland by Infomaniak with no data retention.",
				enabled:                   true,
				whitelisted:               true,
				isOpenSource:              true,
				inputContextTokens:        128000,
				maxOutputTokens:           8192,
				inputUSDPerMillionTokens:  0,
				outputUSDPerMillionTokens: 0,
				tagSlugs:                  []string{"general-purpose", "switzerland"},
			},
			{
				modelID:                   "mistralai-mistral-small-4-119b-2603-infomaniak",
				providerModelID:           "mistralai/Mistral-Small-4-119B-2603",
				name:                      "Mistral Small 4 119B 2603",
				description:               "General-purpose model hosted in Switzerland by Infomaniak with no data retention.",
				enabled:                   true,
				whitelisted:               true,
				inputContextTokens:        128000,
				maxOutputTokens:           8192,
				inputUSDPerMillionTokens:  0,
				outputUSDPerMillionTokens: 0,
				tagSlugs:                  []string{"general-purpose", "switzerland"},
			},
			{
				modelID:                   "qwen-qwen3-5-397b-a17b-fp8-infomaniak",
				providerModelID:           "Qwen/Qwen3.5-397B-A17B-FP8",
				name:                      "Qwen3.5 397B A17B FP8",
				description:               "General-purpose model hosted in Switzerland by Infomaniak with no data retention.",
				enabled:                   true,
				whitelisted:               true,
				isOpenSource:              true,
				inputContextTokens:        128000,
				maxOutputTokens:           8192,
				inputUSDPerMillionTokens:  0,
				outputUSDPerMillionTokens: 0,
				tagSlugs:                  []string{"general-purpose", "switzerland"},
			},
		} {
			tagIDs := make([]string, 0, len(model.tagSlugs))
			for _, slug := range model.tagSlugs {
				tagID, ok := tagsBySlug[slug]
				if !ok {
					continue
				}
				tagIDs = append(tagIDs, tagID)
			}

			inputPrice := model.inputUSDPerMillionTokens
			if inputPrice <= 0 {
				inputPrice = 1
			}
			outputPrice := model.outputUSDPerMillionTokens
			if outputPrice <= 0 {
				outputPrice = 2
			}

			_, err := findOrCreateRecord(app, "ai_models", "model_id", model.modelID, map[string]any{
				"provider":                      provider.Id,
				"provider_model_id":             model.providerModelID,
				"name":                          model.name,
				"slug":                          model.modelID,
				"description":                   model.description,
				"enabled":                       model.enabled,
				"whitelisted":                   model.whitelisted,
				"privacy_tier":                  "ch_only",
				"hosting_country":               "CH",
				"hosting_region":                "switzerland",
				"no_retention":                  true,
				"is_open_source":                model.isOpenSource,
				"input_context_tokens":          model.inputContextTokens,
				"max_output_tokens":             model.maxOutputTokens,
				"input_usd_per_million_tokens":  inputPrice,
				"output_usd_per_million_tokens": outputPrice,
				"tags":                          tagIDs,
			})
			if err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		for _, modelID := range []string{
			"bge-multilingual-gemma2-infomaniak",
			"mini-lm-l12-v2-infomaniak",
			"swiss-ai-apertus-70b-instruct-2509-infomaniak",
			"qwen-qwen3-embedding-8b-infomaniak",
			"mistralai-ministral-3-14b-instruct-2512-infomaniak",
			"qwen-qwen3-5-122b-a10b-fp8-infomaniak",
			"google-gemma-4-31b-it-infomaniak",
			"moonshotai-kimi-k2-6-infomaniak",
			"nvidia-nemotron-3-nano-30b-a3b-fp8-infomaniak",
			"mistralai-mistral-small-4-119b-2603-infomaniak",
			"qwen-qwen3-5-397b-a17b-fp8-infomaniak",
		} {
			record, err := app.FindFirstRecordByData("ai_models", "model_id", modelID)
			if err != nil {
				continue
			}
			if err := app.Delete(record); err != nil {
				return err
			}
		}
		return nil
	})
}
