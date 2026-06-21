package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Seed the Requesty.ai EU gateway catalogue. Region-bearing ids are
// normalised to the @eu meta-region; Requesty load-balances / falls back
// across the underlying EU regions behind it. eu-geolocation models are
// tagged privacy_tier=eu; europe-pinned models whose processing Requesty
// flags as global are privacy_tier=global. Image-generation and Responses
// API variants are seeded but left un-whitelisted until those flows ship.
type requestyModelSeed struct {
	modelID            string
	providerModelID    string
	name               string
	privacyTier        string
	enabled            bool
	whitelisted        bool
	isOpenSource       bool
	inputContextTokens int
	maxOutputTokens    int
	inputUSD           float64
	outputUSD          float64
	tagSlugs           []string
}

func init() {
	m.Register(func(app core.App) error {
		provider, err := findOrCreateRecord(app, "ai_providers", "provider_id", "requesty", map[string]any{
			"name":                "Requesty",
			"description":         "Requesty.ai routes models through a zero-data-retention EU gateway hosted in Frankfurt.",
			"enabled":             true,
			"routing_provider_id": "requesty",
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
			{slug: "image-generation", title: "Image generation", category: "capability"},
			{slug: "reasoning", title: "Reasoning", category: "capability"},
			{slug: "vision", title: "Vision", category: "capability"},
			{slug: "europe", title: "Europe", category: "residency"},
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

		for _, model := range []requestyModelSeed{
			{
				modelID:            "llama-3-3-70b-instruct",
				providerModelID:    "nebius/meta-llama/Llama-3.3-70B-Instruct",
				name:               "Llama 3.3 70B Instruct",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 128000,
				maxOutputTokens:    0,
				inputUSD:           0.13,
				outputUSD:          0.4,
				tagSlugs:           []string{"europe", "general-purpose"},
			},
			{
				modelID:            "gemma-3-27b-it",
				providerModelID:    "nebius/google/gemma-3-27b-it",
				name:               "Gemma 3 27B IT",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 128000,
				maxOutputTokens:    8192,
				inputUSD:           0.1,
				outputUSD:          0.3,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "hermes-4-405b",
				providerModelID:    "nebius/nousresearch/hermes-4-405b",
				name:               "Hermes 4 405B",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 128000,
				maxOutputTokens:    0,
				inputUSD:           1.0,
				outputUSD:          3.0,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "glm-5-2",
				providerModelID:    "nebius/glm-5.2",
				name:               "GLM 5.2",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 1000000,
				maxOutputTokens:    131072,
				inputUSD:           1.4,
				outputUSD:          4.4,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "qwen3-235b-a22b-instruct-2507",
				providerModelID:    "nebius/qwen/qwen3-235b-a22b-instruct-2507",
				name:               "Qwen3 235B A22B Instruct 2507",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 128000,
				maxOutputTokens:    0,
				inputUSD:           0.2,
				outputUSD:          0.6,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "gpt-oss-120b",
				providerModelID:    "nebius/openai/gpt-oss-120b",
				name:               "GPT-OSS 120B",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 131000,
				maxOutputTokens:    128000,
				inputUSD:           0.15,
				outputUSD:          0.6,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "qwen3-30b-a3b-instruct-2507",
				providerModelID:    "nebius/qwen/qwen3-30b-a3b-instruct-2507",
				name:               "Qwen3 30B A3B Instruct 2507",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 128000,
				maxOutputTokens:    0,
				inputUSD:           0.1,
				outputUSD:          0.3,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "qwen3-next-80b-a3b-thinking",
				providerModelID:    "nebius/qwen/qwen3-next-80b-a3b-thinking",
				name:               "Qwen3 Next 80B A3B Thinking",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 128000,
				maxOutputTokens:    0,
				inputUSD:           0.15,
				outputUSD:          1.2,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "hermes-4-70b",
				providerModelID:    "nebius/nousresearch/hermes-4-70b",
				name:               "Hermes 4 70B",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 128000,
				maxOutputTokens:    0,
				inputUSD:           0.13,
				outputUSD:          0.4,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "qwen3-32b",
				providerModelID:    "nebius/qwen/qwen3-32b",
				name:               "Qwen3 32B",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 128000,
				maxOutputTokens:    0,
				inputUSD:           0.1,
				outputUSD:          0.3,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "nemotron-3-nano-omni",
				providerModelID:    "nebius/nvidia/nemotron-3-nano-omni",
				name:               "Nemotron 3 Nano Omni",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 300000,
				maxOutputTokens:    0,
				inputUSD:           0.06,
				outputUSD:          0.24,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "claude-opus-4-8",
				providerModelID:    "bedrock/claude-opus-4-8@eu-central-1",
				name:               "Claude Opus 4.8",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       false,
				inputContextTokens: 1000000,
				maxOutputTokens:    128000,
				inputUSD:           5.5,
				outputUSD:          27.5,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning", "vision"},
			},
			{
				modelID:            "gemini-2-5-flash-image",
				providerModelID:    "vertex/gemini-2.5-flash-image@europe-west1",
				name:               "Gemini 2.5 Flash Image",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        false,
				isOpenSource:       false,
				inputContextTokens: 1048576,
				maxOutputTokens:    65535,
				inputUSD:           0.3,
				outputUSD:          2.5,
				tagSlugs:           []string{"europe", "image-generation", "reasoning", "vision"},
			},
			{
				modelID:            "gemini-2-5-pro",
				providerModelID:    "vertex/gemini-2.5-pro@europe-west1",
				name:               "Gemini 2.5 Pro",
				privacyTier:        "global",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       false,
				inputContextTokens: 1048576,
				maxOutputTokens:    65535,
				inputUSD:           1.25,
				outputUSD:          10.0,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning", "vision"},
			},
			{
				modelID:            "gemini-3-5-flash",
				providerModelID:    "vertex/gemini-3.5-flash@eu",
				name:               "Gemini 3.5 Flash",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       false,
				inputContextTokens: 1048576,
				maxOutputTokens:    65535,
				inputUSD:           1.5,
				outputUSD:          9.0,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning", "vision"},
			},
			{
				modelID:            "gemini-3-1-flash-lite",
				providerModelID:    "vertex/gemini-3.1-flash-lite@eu",
				name:               "Gemini 3.1 Flash Lite",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       false,
				inputContextTokens: 1048576,
				maxOutputTokens:    65535,
				inputUSD:           0.25,
				outputUSD:          1.5,
				tagSlugs:           []string{"europe", "general-purpose", "vision"},
			},
			{
				modelID:            "claude-sonnet-4-6",
				providerModelID:    "bedrock/claude-sonnet-4-6@eu-central-1",
				name:               "Claude Sonnet 4.6",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       false,
				inputContextTokens: 1000000,
				maxOutputTokens:    64000,
				inputUSD:           3.3,
				outputUSD:          16.5,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning", "vision"},
			},
			{
				modelID:            "claude-haiku-4-5",
				providerModelID:    "bedrock/claude-haiku-4-5@eu-central-1",
				name:               "Claude Haiku 4.5",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       false,
				inputContextTokens: 200000,
				maxOutputTokens:    64000,
				inputUSD:           1.1,
				outputUSD:          5.5,
				tagSlugs:           []string{"europe", "general-purpose", "vision"},
			},
			{
				modelID:            "responses-gpt-4-1-nano",
				providerModelID:    "azure/openai-responses/gpt-4.1-nano@swedencentral",
				name:               "GPT-4.1 Nano (Responses)",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        false,
				isOpenSource:       false,
				inputContextTokens: 1047576,
				maxOutputTokens:    32768,
				inputUSD:           0.1,
				outputUSD:          0.4,
				tagSlugs:           []string{"europe", "general-purpose", "vision"},
			},
			{
				modelID:            "gpt-5-nano",
				providerModelID:    "azure/gpt-5-nano@swedencentral",
				name:               "GPT-5 Nano",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       false,
				inputContextTokens: 200000,
				maxOutputTokens:    100000,
				inputUSD:           0.05,
				outputUSD:          0.4,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "o4-mini",
				providerModelID:    "azure/o4-mini@swedencentral",
				name:               "o4 Mini",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       false,
				inputContextTokens: 200000,
				maxOutputTokens:    100000,
				inputUSD:           1.1,
				outputUSD:          4.4,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "gpt-5-mini",
				providerModelID:    "azure/gpt-5-mini@swedencentral",
				name:               "GPT-5 Mini",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       false,
				inputContextTokens: 200000,
				maxOutputTokens:    100000,
				inputUSD:           0.25,
				outputUSD:          2.0,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "responses-gpt-5-5",
				providerModelID:    "azure/openai-responses/gpt-5.5@swedencentral",
				name:               "GPT-5.5 (Responses)",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        false,
				isOpenSource:       false,
				inputContextTokens: 1050000,
				maxOutputTokens:    128000,
				inputUSD:           5.0,
				outputUSD:          30.0,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning", "vision"},
			},
			{
				modelID:            "responses-gpt-4-1-mini",
				providerModelID:    "azure/openai-responses/gpt-4.1-mini@francecentral",
				name:               "GPT-4.1 Mini (Responses)",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        false,
				isOpenSource:       false,
				inputContextTokens: 1047576,
				maxOutputTokens:    32768,
				inputUSD:           0.4,
				outputUSD:          1.6,
				tagSlugs:           []string{"europe", "general-purpose", "vision"},
			},
			{
				modelID:            "gpt-4o-mini",
				providerModelID:    "azure/gpt-4o-mini@swedencentral",
				name:               "GPT-4o Mini",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       false,
				inputContextTokens: 128000,
				maxOutputTokens:    16000,
				inputUSD:           0.15,
				outputUSD:          0.6,
				tagSlugs:           []string{"europe", "general-purpose", "vision"},
			},
			{
				modelID:            "gpt-5-5",
				providerModelID:    "azure/gpt-5.5@swedencentral",
				name:               "GPT-5.5",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       false,
				inputContextTokens: 1050000,
				maxOutputTokens:    128000,
				inputUSD:           5.0,
				outputUSD:          30.0,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning", "vision"},
			},
			{
				modelID:            "minimax-m2-5",
				providerModelID:    "bedrock/minimax-m2.5@eu-central-1",
				name:               "MiniMax M2.5",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 196608,
				maxOutputTokens:    16000,
				inputUSD:           0.36,
				outputUSD:          1.44,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning"},
			},
			{
				modelID:            "kimi-k2-6",
				providerModelID:    "inceptron/kimi-k2.6",
				name:               "Kimi K2.6",
				privacyTier:        "eu",
				enabled:            true,
				whitelisted:        true,
				isOpenSource:       true,
				inputContextTokens: 262144,
				maxOutputTokens:    262144,
				inputUSD:           0.8,
				outputUSD:          3.5,
				tagSlugs:           []string{"europe", "general-purpose", "reasoning", "vision"},
			},
		} {
			tagIDs := make([]string, 0, len(model.tagSlugs))
			for _, slug := range model.tagSlugs {
				if id, ok := tagsBySlug[slug]; ok {
					tagIDs = append(tagIDs, id)
				}
			}

			fields := map[string]any{
				"provider":                      provider.Id,
				"provider_model_id":             model.providerModelID,
				"name":                          model.name,
				"slug":                          model.modelID,
				"description":                   "Served through Requesty's EU gateway in Frankfurt.",
				"enabled":                       model.enabled,
				"whitelisted":                   model.whitelisted,
				"privacy_tier":                  model.privacyTier,
				"hosting_country":               "EU",
				"hosting_region":                "eu",
				"no_retention":                  true,
				"is_open_source":                model.isOpenSource,
				"input_context_tokens":          model.inputContextTokens,
				"input_usd_per_million_tokens":  model.inputUSD,
				"output_usd_per_million_tokens": model.outputUSD,
				"tags":                          tagIDs,
			}
			if model.maxOutputTokens > 0 {
				fields["max_output_tokens"] = model.maxOutputTokens
			}

			if _, err := findOrCreateRecord(app, "ai_models", "model_id", model.modelID, fields); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		for _, modelID := range []string{
			"llama-3-3-70b-instruct",
			"gemma-3-27b-it",
			"hermes-4-405b",
			"glm-5-2",
			"qwen3-235b-a22b-instruct-2507",
			"gpt-oss-120b",
			"qwen3-30b-a3b-instruct-2507",
			"qwen3-next-80b-a3b-thinking",
			"hermes-4-70b",
			"qwen3-32b",
			"nemotron-3-nano-omni",
			"claude-opus-4-8",
			"gemini-2-5-flash-image",
			"gemini-2-5-pro",
			"gemini-3-5-flash",
			"gemini-3-1-flash-lite",
			"claude-sonnet-4-6",
			"claude-haiku-4-5",
			"responses-gpt-4-1-nano",
			"gpt-5-nano",
			"o4-mini",
			"gpt-5-mini",
			"responses-gpt-5-5",
			"responses-gpt-4-1-mini",
			"gpt-4o-mini",
			"gpt-5-5",
			"minimax-m2-5",
			"kimi-k2-6",
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
