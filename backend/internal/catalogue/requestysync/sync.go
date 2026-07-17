package requestysync

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// ModelsFetcher is the slice of the Requesty client the sync depends on, so
// tests can supply canned model lists.
type ModelsFetcher interface {
	FetchModels(ctx context.Context) ([]RequestyModel, error)
}

// Summary reports what a sync run changed, for logging.
type Summary struct {
	Fetched          int
	Discovered       int
	Matched          int
	Updated          int
	ReasoningEnabled int
	// Unavailable counts models marked unavailable because they vanished from
	// Requesty. Their operator-owned enabled flag is preserved.
	Unavailable int
	// DisableSkipped is true when the legacy-named absent-model pass was skipped
	// because the fetch looked unhealthy and force was not set.
	DisableSkipped bool
}

// SyncOptions tunes a sync run.
type SyncOptions struct {
	// ForceDisableAbsent marks every available Requesty model missing from the
	// fetch unavailable, bypassing the health-threshold guard. Used for a manual
	// cleanup after intentionally removing models. An empty fetch is still never
	// treated as a removal signal, even when forced.
	ForceDisableAbsent bool
}

// maxDisableAbsentFraction guards against a partial Requesty response marking
// a large slice of the catalogue unavailable: if more than this share of
// available Requesty models is absent, the pass is skipped unless forced.
const maxDisableAbsentFraction = 0.25

// Service mirrors Requesty's available model set and enriches model metadata.
type Service struct {
	app     core.App
	fetcher ModelsFetcher
	logger  *slog.Logger
}

func NewService(app core.App, fetcher ModelsFetcher, logger *slog.Logger) *Service {
	return &Service{app: app, fetcher: fetcher, logger: logger}
}

// Run fetches the Requesty catalogue, creates newly exposed models, and updates
// matched ai_models records. New models are enabled and whitelisted but receive
// a conservative privacy tier derived from Requesty's geolocation (unknown and
// non-EU locations are global). Existing operator-owned curation/compliance
// fields (enabled, whitelisted, privacy_tier, hosting_*, display name) are never
// overwritten. Provider availability is stored separately, so disappearance
// from Requesty cannot erase a local enabled override and reappearance cannot
// undo a local disable. Reasoning efforts and release date are only backfilled
// when absent, so manual corrections win.
// The availability pass is guarded against a partial/empty fetch (see
// maxDisableAbsentFraction) unless opts.ForceDisableAbsent is set. Idempotent
// and safe to run repeatedly.
func (s *Service) Run(ctx context.Context, opts SyncOptions) (Summary, error) {
	var summary Summary
	if s == nil || s.app == nil || s.fetcher == nil {
		return summary, fmt.Errorf("requesty sync is not configured")
	}

	provider, err := s.app.FindFirstRecordByData("ai_providers", "provider_id", "requesty")
	if err != nil {
		// No Requesty provider in this environment — nothing to enrich.
		return summary, nil
	}

	models, err := s.fetcher.FetchModels(ctx)
	if err != nil {
		return summary, fmt.Errorf("fetch requesty models: %w", err)
	}
	summary.Fetched = len(models)
	byID := index(models)

	records, err := s.app.FindAllRecords("ai_models", dbx.HashExp{"provider": provider.Id})
	if err != nil {
		return summary, fmt.Errorf("load requesty models: %w", err)
	}

	recordsByID := make(map[string]*core.Record, len(records))
	for _, record := range records {
		recordsByID[NormalizeID(record.GetString("provider_model_id"))] = record
	}
	for normalizedID, model := range byID {
		if _, exists := recordsByID[normalizedID]; exists {
			continue
		}
		record, createErr := s.createDiscoveredModel(provider, model)
		if createErr != nil {
			if s.logger != nil {
				s.logger.Error("requesty sync: failed to create discovered model",
					"provider_model_id", model.ID, "err", createErr)
			}
			continue
		}
		records = append(records, record)
		recordsByID[normalizedID] = record
		summary.Discovered++
	}

	var absentAvailable []*core.Record
	availableCount := 0
	for _, record := range records {
		isAvailable := record.GetBool("provider_available")
		if isAvailable {
			availableCount++
		}

		model, ok := byID[NormalizeID(record.GetString("provider_model_id"))]
		if !ok {
			// Present locally but gone from Requesty — an availability update
			// candidate (handled after the loop, behind the health guard).
			if isAvailable {
				absentAvailable = append(absentAvailable, record)
			}
			continue
		}
		summary.Matched++

		changed := false
		if !isAvailable {
			record.Set("provider_available", true)
			changed = true
		}

		// Pricing and context refresh on every run — these drift.
		if input := perMillion(model.InputPrice); input > 0 &&
			input != record.GetFloat("input_usd_per_million_tokens") {
			record.Set("input_usd_per_million_tokens", input)
			changed = true
		}
		if output := perMillion(model.OutputPrice); output > 0 &&
			output != record.GetFloat("output_usd_per_million_tokens") {
			record.Set("output_usd_per_million_tokens", output)
			changed = true
		}
		if model.ContextWindow > 0 && model.ContextWindow != record.GetInt("input_context_tokens") {
			record.Set("input_context_tokens", model.ContextWindow)
			changed = true
		}
		if model.MaxOutputTokens > 0 && model.MaxOutputTokens != record.GetInt("max_output_tokens") {
			record.Set("max_output_tokens", model.MaxOutputTokens)
			changed = true
		}

		// Capability flags are authoritative facts from Requesty, refreshed on
		// every run.
		for field, want := range map[string]bool{
			"supports_vision":       model.SupportsVision,
			"supports_tool_calling": model.SupportsToolCalling,
			"supports_web_search":   supportsWebSearchFor(model),
			"supports_computer_use": model.SupportsComputerUse,
		} {
			if record.GetBool(field) != want {
				record.Set(field, want)
				changed = true
			}
		}

		// Image generation: the sync only ever turns it ON, never OFF. A model
		// becomes image-capable when Requesty reports it AND a curated transport
		// is set (so we know how to route images_api vs chat_completions), then
		// flips on automatically — no broken routing in between. We never write
		// false, so a transient omission in Requesty's data can't disable a
		// curated image model; operators disable it manually.
		if imageGenerationEnabled(model, record.GetString("image_generation_transport")) &&
			!record.GetBool("supports_image_generation") {
			record.Set("supports_image_generation", true)
			changed = true
		}

		// Release date: backfill only when we have no date yet, so a curated
		// value (which may correct a wrong or missing upstream one) always wins.
		if released, ok := releasedAtBackfill(
			model.Created, record.GetDateTime("released_at").IsZero(),
		); ok {
			record.Set("released_at", released)
			changed = true
		}

		// Reasoning efforts: set only when the model reasons and none are set,
		// so a curated/manual override is never clobbered.
		if efforts, def := reasoningEffortsFor(model); efforts != nil &&
			len(record.GetStringSlice("reasoning_efforts")) == 0 {
			record.Set("reasoning_efforts", efforts)
			record.Set("default_reasoning_effort", def)
			changed = true
			summary.ReasoningEnabled++
		}

		if !changed {
			continue
		}
		if err := s.app.Save(record); err != nil {
			// One bad record shouldn't abort the whole sync.
			if s.logger != nil {
				s.logger.Error("requesty sync: failed to save model",
					"model_id", record.GetString("model_id"), "err", err)
			}
			continue
		}
		summary.Updated++
	}

	// Availability pass: models removed from Requesty stop working, so mark them
	// unavailable (never delete them or overwrite local enabled). Guard against a
	// partial/empty fetch hiding the catalogue — skip unless the absent share is
	// small or the caller forces it. An empty fetch is never a valid removal
	// signal, even when forced.
	if len(absentAvailable) > 0 {
		absentFraction := 1.0
		if availableCount > 0 {
			absentFraction = float64(len(absentAvailable)) / float64(availableCount)
		}
		healthyFetch := summary.Fetched > 0
		if healthyFetch && (opts.ForceDisableAbsent || absentFraction <= maxDisableAbsentFraction) {
			for _, record := range absentAvailable {
				record.Set("provider_available", false)
				if err := s.app.Save(record); err != nil {
					if s.logger != nil {
						s.logger.Error("requesty sync: failed to mark absent model unavailable",
							"model_id", record.GetString("model_id"), "err", err)
					}
					continue
				}
				summary.Unavailable++
			}
		} else {
			summary.DisableSkipped = true
			if s.logger != nil {
				s.logger.Warn("requesty sync: skipped marking absent models unavailable",
					"absent", len(absentAvailable), "available", availableCount,
					"absent_fraction", absentFraction, "fetched", summary.Fetched,
					"forced", opts.ForceDisableAbsent,
					"hint", "re-run with force to override the health guard")
			}
		}
	}

	if s.logger != nil {
		s.logger.Info("requesty model sync complete",
			"fetched", summary.Fetched, "discovered", summary.Discovered,
			"matched", summary.Matched,
			"updated", summary.Updated, "reasoning_enabled", summary.ReasoningEnabled,
			"unavailable", summary.Unavailable, "disable_skipped", summary.DisableSkipped)
	}
	return summary, nil
}

func (s *Service) createDiscoveredModel(provider *core.Record, model RequestyModel) (*core.Record, error) {
	if strings.TrimSpace(model.ID) == "" {
		return nil, fmt.Errorf("provider model id is empty")
	}
	if model.ContextWindow <= 0 {
		return nil, fmt.Errorf("model %q has no valid context window", model.ID)
	}

	collection, err := s.app.FindCollectionByNameOrId("ai_models")
	if err != nil {
		return nil, fmt.Errorf("load ai_models collection: %w", err)
	}
	record := core.NewRecord(collection)
	modelID := discoveredModelID(model.ID)
	name := discoveredModelName(model.ID)
	privacyTier, hostingCountry, hostingRegion := discoveredResidency(model.Geolocation)
	record.Load(map[string]any{
		"model_id":                      modelID,
		"provider":                      provider.Id,
		"provider_model_id":             strings.TrimSpace(model.ID),
		"name":                          name,
		"display_name":                  name,
		"slug":                          modelID,
		"description":                   strings.TrimSpace(model.Description),
		"enabled":                       true,
		"whitelisted":                   true,
		"provider_available":            true,
		"privacy_tier":                  privacyTier,
		"hosting_country":               hostingCountry,
		"hosting_region":                hostingRegion,
		"no_retention":                  true,
		"is_open_source":                false,
		"input_context_tokens":          model.ContextWindow,
		"max_output_tokens":             model.MaxOutputTokens,
		"input_usd_per_million_tokens":  perMillion(model.InputPrice),
		"output_usd_per_million_tokens": perMillion(model.OutputPrice),
		"supports_text_completion":      supportsTextCompletionFor(model),
		"supports_vision":               model.SupportsVision,
		"supports_tool_calling":         model.SupportsToolCalling,
		"supports_web_search":           supportsWebSearchFor(model),
		"supports_computer_use":         model.SupportsComputerUse,
	})
	if released, ok := releasedAtBackfill(model.Created, true); ok {
		record.Set("released_at", released)
	}
	if efforts, def := reasoningEffortsFor(model); efforts != nil {
		record.Set("reasoning_efforts", efforts)
		record.Set("default_reasoning_effort", def)
	}
	if err := s.app.Save(record); err != nil {
		return nil, fmt.Errorf("save discovered model %q: %w", model.ID, err)
	}
	return record, nil
}
