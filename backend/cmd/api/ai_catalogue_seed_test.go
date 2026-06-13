package main

import (
	"testing"
)

func TestDefaultAICatalogueSeedsCurrentInfomaniakSnapshot(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	cases := []struct {
		modelID       string
		providerModel string
		enabled       bool
		whitelisted   bool
	}{
		{modelID: "llama-3-3-infomaniak", providerModel: "llama-3.3-70b-instruct", enabled: true, whitelisted: true},
		{modelID: "bge-multilingual-gemma2-infomaniak", providerModel: "bge_multilingual_gemma2", enabled: false, whitelisted: false},
		{modelID: "mini-lm-l12-v2-infomaniak", providerModel: "mini_lm_l12_v2", enabled: false, whitelisted: false},
		{modelID: "swiss-ai-apertus-70b-instruct-2509-infomaniak", providerModel: "swiss-ai/Apertus-70B-Instruct-2509", enabled: true, whitelisted: true},
		{modelID: "qwen-qwen3-embedding-8b-infomaniak", providerModel: "Qwen/Qwen3-Embedding-8B", enabled: false, whitelisted: false},
		{modelID: "mistralai-ministral-3-14b-instruct-2512-infomaniak", providerModel: "mistralai/Ministral-3-14B-Instruct-2512", enabled: true, whitelisted: true},
		{modelID: "qwen-qwen3-5-122b-a10b-fp8-infomaniak", providerModel: "Qwen/Qwen3.5-122B-A10B-FP8", enabled: true, whitelisted: true},
		{modelID: "google-gemma-4-31b-it-infomaniak", providerModel: "google/gemma-4-31B-it", enabled: true, whitelisted: true},
		{modelID: "moonshotai-kimi-k2-6-infomaniak", providerModel: "moonshotai/Kimi-K2.6", enabled: true, whitelisted: true},
		{modelID: "nvidia-nemotron-3-nano-30b-a3b-fp8-infomaniak", providerModel: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8", enabled: true, whitelisted: true},
		{modelID: "mistralai-mistral-small-4-119b-2603-infomaniak", providerModel: "mistralai/Mistral-Small-4-119B-2603", enabled: true, whitelisted: true},
		{modelID: "qwen-qwen3-5-397b-a17b-fp8-infomaniak", providerModel: "Qwen/Qwen3.5-397B-A17B-FP8", enabled: true, whitelisted: true},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.modelID, func(t *testing.T) {
			record, err := app.FindFirstRecordByData("ai_models", "model_id", tc.modelID)
			if err != nil {
				t.Fatalf("FindFirstRecordByData(ai_models, %q) error = %v", tc.modelID, err)
			}
			if got := record.GetString("provider_model_id"); got != tc.providerModel {
				t.Fatalf("provider_model_id = %q, want %q", got, tc.providerModel)
			}
			if got := record.GetBool("enabled"); got != tc.enabled {
				t.Fatalf("enabled = %v, want %v", got, tc.enabled)
			}
			if got := record.GetBool("whitelisted"); got != tc.whitelisted {
				t.Fatalf("whitelisted = %v, want %v", got, tc.whitelisted)
			}
		})
	}
}
