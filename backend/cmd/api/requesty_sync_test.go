package main

import (
	"context"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue/requestysync"
	"github.com/pocketbase/dbx"
)

type stubFetcher struct {
	models []requestysync.RequestyModel
}

func (s stubFetcher) FetchModels(context.Context) ([]requestysync.RequestyModel, error) {
	return s.models, nil
}

// Drives the sync off the real seeded Requesty catalogue: it enriches derived
// fields (reasoning, pricing, context), matches across differing regions,
// preserves a hand-curated reasoning override, and never touches
// curation/compliance fields.
func TestRequestySyncEnrichesMatchedModelsAndPreservesCuration(t *testing.T) {
	t.Parallel()

	app := setupTestApp(t)

	provider, err := app.FindFirstRecordByData("ai_providers", "provider_id", "requesty")
	if err != nil {
		t.Fatalf("requesty provider not seeded: %v", err)
	}
	records, err := app.FindAllRecords("ai_models", dbx.HashExp{"provider": provider.Id})
	if err != nil || len(records) < 2 {
		t.Fatalf("need >=2 seeded requesty models, got %d (err=%v)", len(records), err)
	}

	// Model A: enrich from scratch (clear any reasoning so we assert the set path).
	enrichTarget := records[0]
	enrichTarget.Set("reasoning_efforts", []string{})
	enrichTarget.Set("default_reasoning_effort", "")
	if err := app.Save(enrichTarget); err != nil {
		t.Fatalf("reset model A: %v", err)
	}
	wantWhitelisted := enrichTarget.GetBool("whitelisted")
	wantTier := enrichTarget.GetString("privacy_tier")
	wantRegion := enrichTarget.GetString("hosting_region")

	// Model B: a hand-curated reasoning override that must survive the sync.
	curated := records[1]
	curated.Set("reasoning_efforts", []string{"minimal", "high"})
	curated.Set("default_reasoning_effort", "high")
	if err := app.Save(curated); err != nil {
		t.Fatalf("seed curated override: %v", err)
	}

	fetcher := stubFetcher{models: []requestysync.RequestyModel{
		{
			// Same base id, different region — must still match.
			ID:                requestysync.NormalizeID(enrichTarget.GetString("provider_model_id")) + "@eastus2",
			SupportsReasoning: true,
			InputPrice:        0.0000011, // -> 1.1 / M
			OutputPrice:       0.0000044, // -> 4.4 / M
			ContextWindow:     200000,
			MaxOutputTokens:   100000,
		},
		{
			ID:                curated.GetString("provider_model_id"),
			SupportsReasoning: true,
			InputPrice:        0.0000005,
			ContextWindow:     400000,
		},
	}}

	summary, err := requestysync.NewService(app, fetcher, nil).Run(context.Background())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if summary.Matched < 2 || summary.ReasoningEnabled != 1 {
		t.Fatalf("summary = %+v, want matched >=2 / reasoning enabled 1", summary)
	}

	got, err := app.FindRecordById("ai_models", enrichTarget.Id)
	if err != nil {
		t.Fatalf("reload model A: %v", err)
	}
	if efforts := got.GetStringSlice("reasoning_efforts"); len(efforts) != 4 || efforts[0] != "off" {
		t.Fatalf("reasoning_efforts = %v, want [off low medium high]", efforts)
	}
	if got.GetString("default_reasoning_effort") != "medium" {
		t.Fatalf("default_reasoning_effort = %q, want medium", got.GetString("default_reasoning_effort"))
	}
	if got.GetFloat("input_usd_per_million_tokens") != 1.1 {
		t.Fatalf("input price = %v, want 1.1", got.GetFloat("input_usd_per_million_tokens"))
	}
	if got.GetInt("input_context_tokens") != 200000 {
		t.Fatalf("context = %d, want 200000", got.GetInt("input_context_tokens"))
	}
	if got.GetBool("whitelisted") != wantWhitelisted ||
		got.GetString("privacy_tier") != wantTier ||
		got.GetString("hosting_region") != wantRegion {
		t.Fatalf("curation/compliance fields were modified by the sync")
	}

	gotCurated, err := app.FindRecordById("ai_models", curated.Id)
	if err != nil {
		t.Fatalf("reload model B: %v", err)
	}
	if efforts := gotCurated.GetStringSlice("reasoning_efforts"); len(efforts) != 2 || efforts[0] != "minimal" {
		t.Fatalf("curated override clobbered: reasoning_efforts = %v, want [minimal high]", efforts)
	}
}
