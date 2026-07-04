package main

import (
	"context"
	"testing"

	"github.com/cognos-io/chat.cognos.io/backend/internal/catalogue/requestysync"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// enabledRequestyModels returns the enabled Requesty ai_models records.
func enabledRequestyModels(t testing.TB, app *tests.TestApp) []*core.Record {
	t.Helper()
	provider, err := app.FindFirstRecordByData("ai_providers", "provider_id", "requesty")
	if err != nil {
		t.Fatalf("requesty provider not seeded: %v", err)
	}
	records, err := app.FindAllRecords("ai_models", dbx.HashExp{"provider": provider.Id})
	if err != nil {
		t.Fatalf("load requesty models: %v", err)
	}
	enabled := make([]*core.Record, 0, len(records))
	for _, r := range records {
		if r.GetBool("enabled") {
			enabled = append(enabled, r)
		}
	}
	return enabled
}

func fetcherFor(records []*core.Record) stubFetcher {
	models := make([]requestysync.RequestyModel, 0, len(records))
	for _, r := range records {
		models = append(models, requestysync.RequestyModel{ID: r.GetString("provider_model_id")})
	}
	return stubFetcher{models: models}
}

// A model removed from Requesty is disabled (not deleted) when the fetch is
// healthy (only a small share absent).
func TestRequestySyncDisablesAbsentModelWhenFetchHealthy(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)

	enabled := enabledRequestyModels(t, app)
	if len(enabled) < 5 {
		t.Fatalf("need >=5 enabled requesty models for a <25%% absent share, got %d", len(enabled))
	}
	removed := enabled[0]

	// Fetch everything except the one "removed" model.
	summary, err := requestysync.NewService(app, fetcherFor(enabled[1:]), nil).
		Run(context.Background(), requestysync.SyncOptions{})
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if summary.Disabled != 1 || summary.DisableSkipped {
		t.Fatalf("summary = %+v, want Disabled=1 DisableSkipped=false", summary)
	}

	gotRemoved, _ := app.FindRecordById("ai_models", removed.Id)
	if gotRemoved.GetBool("enabled") {
		t.Fatalf("absent model should be disabled")
	}
	gotKept, _ := app.FindRecordById("ai_models", enabled[1].Id)
	if !gotKept.GetBool("enabled") {
		t.Fatalf("matched model should stay enabled")
	}
}

// A partial fetch (most models absent) skips the disable pass unless forced.
func TestRequestySyncSkipsDisableOnUnhealthyFetchUnlessForced(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)

	enabled := enabledRequestyModels(t, app)
	if len(enabled) < 5 {
		t.Fatalf("need >=5 enabled requesty models, got %d", len(enabled))
	}
	// Fetch only the first model — the rest look absent (well over the threshold).
	partial := fetcherFor(enabled[:1])

	// Without force: skipped, nothing disabled.
	summary, err := requestysync.NewService(app, partial, nil).
		Run(context.Background(), requestysync.SyncOptions{})
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if !summary.DisableSkipped || summary.Disabled != 0 {
		t.Fatalf("summary = %+v, want DisableSkipped=true Disabled=0", summary)
	}
	if gotReload, _ := app.FindRecordById("ai_models", enabled[1].Id); !gotReload.GetBool("enabled") {
		t.Fatalf("model wrongly disabled without force")
	}

	// With force: the health guard is bypassed and absent models are disabled.
	forced, err := requestysync.NewService(app, partial, nil).
		Run(context.Background(), requestysync.SyncOptions{ForceDisableAbsent: true})
	if err != nil {
		t.Fatalf("Run(force) error = %v", err)
	}
	if forced.Disabled == 0 || forced.DisableSkipped {
		t.Fatalf("forced summary = %+v, want Disabled>0 DisableSkipped=false", forced)
	}
	if gotReload, _ := app.FindRecordById("ai_models", enabled[1].Id); gotReload.GetBool("enabled") {
		t.Fatalf("absent model should be disabled under force")
	}
}

// An empty fetch is never treated as a removal signal, even when forced.
func TestRequestySyncNeverDisablesOnEmptyFetchEvenForced(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)

	enabled := enabledRequestyModels(t, app)
	if len(enabled) == 0 {
		t.Fatalf("need seeded requesty models")
	}

	summary, err := requestysync.NewService(app, stubFetcher{}, nil).
		Run(context.Background(), requestysync.SyncOptions{ForceDisableAbsent: true})
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if summary.Disabled != 0 || !summary.DisableSkipped {
		t.Fatalf("summary = %+v, want Disabled=0 DisableSkipped=true on empty fetch", summary)
	}
	if gotReload, _ := app.FindRecordById("ai_models", enabled[0].Id); !gotReload.GetBool("enabled") {
		t.Fatalf("empty fetch must never disable models, even forced")
	}
}

// A model whose supports_web_search flag was previously true gets downgraded
// to false on the next sync when Requesty reports it outside the EU — the
// flag must never survive non-EU-hosted serving (spec Decision 2), even if
// Requesty itself still reports the model as search-capable.
func TestRequestySyncForcesWebSearchOffOutsideEU(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)

	enabled := enabledRequestyModels(t, app)
	if len(enabled) == 0 {
		t.Fatalf("need >=1 enabled requesty model")
	}

	target := enabled[0]
	target.Set("supports_web_search", true)
	if err := app.Save(target); err != nil {
		t.Fatalf("seed supports_web_search=true: %v", err)
	}

	fetcher := stubFetcher{models: []requestysync.RequestyModel{
		{
			ID:                target.GetString("provider_model_id"),
			SupportsWebSearch: true, // Requesty still says capable...
			Geolocation:       "us", // ...but not EU-hosted.
		},
	}}

	if _, err := requestysync.NewService(app, fetcher, nil).Run(context.Background(), requestysync.SyncOptions{}); err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	got, err := app.FindRecordById("ai_models", target.Id)
	if err != nil {
		t.Fatalf("reload model: %v", err)
	}
	if got.GetBool("supports_web_search") {
		t.Fatal("supports_web_search should be downgraded to false outside the EU")
	}
}

// The mirror case: an EU-hosted, search-capable model keeps the flag on.
func TestRequestySyncKeepsWebSearchForEUHostedModel(t *testing.T) {
	t.Parallel()
	app := setupTestApp(t)

	enabled := enabledRequestyModels(t, app)
	if len(enabled) == 0 {
		t.Fatalf("need >=1 enabled requesty model")
	}

	target := enabled[0]
	target.Set("supports_web_search", false)
	if err := app.Save(target); err != nil {
		t.Fatalf("seed supports_web_search=false: %v", err)
	}

	fetcher := stubFetcher{models: []requestysync.RequestyModel{
		{
			ID:                target.GetString("provider_model_id"),
			SupportsWebSearch: true,
			Geolocation:       "eu",
		},
	}}

	if _, err := requestysync.NewService(app, fetcher, nil).Run(context.Background(), requestysync.SyncOptions{}); err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	got, err := app.FindRecordById("ai_models", target.Id)
	if err != nil {
		t.Fatalf("reload model: %v", err)
	}
	if !got.GetBool("supports_web_search") {
		t.Fatal("supports_web_search should be enabled for an EU-hosted, search-capable model")
	}
}

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
			ID:                  requestysync.NormalizeID(enrichTarget.GetString("provider_model_id")) + "@eastus2",
			SupportsReasoning:   true,
			SupportsVision:      true,
			SupportsToolCalling: true,
			InputPrice:          0.0000011, // -> 1.1 / M
			OutputPrice:         0.0000044, // -> 4.4 / M
			ContextWindow:       200000,
			MaxOutputTokens:     100000,
		},
		{
			ID:                curated.GetString("provider_model_id"),
			SupportsReasoning: true,
			InputPrice:        0.0000005,
			ContextWindow:     400000,
		},
	}}

	summary, err := requestysync.NewService(app, fetcher, nil).Run(context.Background(), requestysync.SyncOptions{})
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
	if !got.GetBool("supports_vision") || !got.GetBool("supports_tool_calling") {
		t.Fatalf("capability flags not synced: vision=%v tool_calling=%v",
			got.GetBool("supports_vision"), got.GetBool("supports_tool_calling"))
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
