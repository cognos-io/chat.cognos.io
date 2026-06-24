package requestysync

import "strings"

// standardReasoningEfforts is the uniform tier set Requesty normalises across
// every provider it routes (it maps these to OpenAI effort strings or
// Anthropic/Google thinking budgets internally). "off" disables reasoning.
var standardReasoningEfforts = []string{"off", "low", "medium", "high"}

const standardDefaultReasoningEffort = "medium"

// NormalizeID strips Requesty's optional "@region" suffix and lowercases, so our
// curated provider_model_id (e.g. "azure/o4-mini@swedencentral") matches a
// Requesty model id (e.g. "azure/o4-mini@eastus2" or "azure/o4-mini").
func NormalizeID(id string) string {
	id = strings.ToLower(strings.TrimSpace(id))
	if at := strings.IndexByte(id, '@'); at >= 0 {
		id = id[:at]
	}
	return id
}

// index builds a lookup of Requesty models by normalised id. On duplicate base
// ids (same model in two regions) the first wins — pricing/capability are the
// same across regions, which is all we read.
func index(models []RequestyModel) map[string]RequestyModel {
	byID := make(map[string]RequestyModel, len(models))
	for _, model := range models {
		key := NormalizeID(model.ID)
		if key == "" {
			continue
		}
		if _, exists := byID[key]; !exists {
			byID[key] = model
		}
	}
	return byID
}

// reasoningEffortsFor returns the effort tiers + default to apply to a model, or
// (nil, "") when Requesty reports it doesn't reason.
func reasoningEffortsFor(model RequestyModel) ([]string, string) {
	if !model.SupportsReasoning {
		return nil, ""
	}
	return standardReasoningEfforts, standardDefaultReasoningEffort
}

// perMillion converts a per-token price to per-million-tokens (our stored unit).
func perMillion(perToken float64) float64 {
	return perToken * 1_000_000
}

// imageGenerationEnabled decides whether a model is advertised as image-capable.
// Requesty is the source of truth for the capability, but we only enable it when
// a curated image_generation_transport is set — otherwise we'd advertise a model
// we don't yet know how to route. So a new image-capable model stays off until an
// operator sets the transport, then flips on automatically on the next sync.
func imageGenerationEnabled(model RequestyModel, transport string) bool {
	return model.SupportsImageGeneration && strings.TrimSpace(transport) != ""
}
