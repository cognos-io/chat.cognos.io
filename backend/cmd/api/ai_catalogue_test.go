package main

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

type providerSeed struct {
	ProviderID        string
	Name              string
	Description       string
	Enabled           bool
	RoutingProviderID string
}

type tagSeed struct {
	Slug     string
	Title    string
	Category string
}

type modelSeed struct {
	ModelID                   string
	ProviderRecordID          string
	ProviderModelID           string
	Name                      string
	Slug                      string
	Description               string
	Enabled                   bool
	Whitelisted               bool
	PrivacyTier               string
	HostingCountry            string
	HostingRegion             string
	NoRetention               bool
	IsOpenSource              bool
	InputContextTokens        int
	MaxOutputTokens           int
	InputUSDPerMillionTokens  float64
	OutputUSDPerMillionTokens float64
	TagRecordIDs              []string
	ReasoningEfforts          []string
	DefaultReasoningEffort    string
	SupportsTextCompletion    bool
	SupportsImageGeneration   bool
}

func seedAIProvider(t testing.TB, app *tests.TestApp, seed providerSeed) string {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("ai_providers")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(ai_providers) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Set("provider_id", seed.ProviderID)
	record.Set("name", seed.Name)
	record.Set("description", seed.Description)
	record.Set("enabled", seed.Enabled)
	record.Set("routing_provider_id", seed.RoutingProviderID)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(ai_providers %q) error = %v", seed.ProviderID, err)
	}

	return record.Id
}

func seedAITag(t testing.TB, app *tests.TestApp, seed tagSeed) string {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("ai_tags")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(ai_tags) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Set("slug", seed.Slug)
	record.Set("title", seed.Title)
	record.Set("category", seed.Category)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(ai_tags %q) error = %v", seed.Slug, err)
	}

	return record.Id
}

func seedAIModel(t testing.TB, app *tests.TestApp, seed modelSeed) string {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("ai_models")
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId(ai_models) error = %v", err)
	}

	record := core.NewRecord(collection)
	record.Set("model_id", seed.ModelID)
	record.Set("provider", seed.ProviderRecordID)
	record.Set("provider_model_id", seed.ProviderModelID)
	record.Set("name", seed.Name)
	record.Set("slug", seed.Slug)
	record.Set("description", seed.Description)
	record.Set("enabled", seed.Enabled)
	record.Set("whitelisted", seed.Whitelisted)
	record.Set("privacy_tier", seed.PrivacyTier)
	record.Set("hosting_country", seed.HostingCountry)
	record.Set("hosting_region", seed.HostingRegion)
	record.Set("no_retention", seed.NoRetention)
	record.Set("is_open_source", seed.IsOpenSource)
	record.Set("input_context_tokens", seed.InputContextTokens)
	record.Set("max_output_tokens", seed.MaxOutputTokens)
	record.Set("input_usd_per_million_tokens", seed.InputUSDPerMillionTokens)
	record.Set("output_usd_per_million_tokens", seed.OutputUSDPerMillionTokens)
	record.Set("tags", seed.TagRecordIDs)
	if seed.ReasoningEfforts != nil {
		record.Set("reasoning_efforts", seed.ReasoningEfforts)
	}
	record.Set("default_reasoning_effort", seed.DefaultReasoningEffort)
	record.Set("supports_text_completion", seed.SupportsTextCompletion)
	record.Set("supports_image_generation", seed.SupportsImageGeneration)
	if err := app.Save(record); err != nil {
		t.Fatalf("Save(ai_models %q) error = %v", seed.ModelID, err)
	}

	return record.Id
}
