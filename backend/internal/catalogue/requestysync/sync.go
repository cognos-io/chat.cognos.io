package requestysync

import (
	"context"
	"fmt"
	"log/slog"

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
	Matched          int
	Updated          int
	ReasoningEnabled int
	// Disabled counts models disabled because they vanished from Requesty.
	Disabled int
	// DisableSkipped is true when the disable pass was skipped because the fetch
	// looked unhealthy (too many models absent) and force was not set.
	DisableSkipped bool
}

// SyncOptions tunes a sync run.
type SyncOptions struct {
	// ForceDisableAbsent disables every enabled Requesty model missing from the
	// fetch, bypassing the health-threshold guard. Used for a manual cleanup
	// after intentionally removing models. An empty fetch is still never treated
	// as a removal signal, even when forced.
	ForceDisableAbsent bool
}

// maxDisableAbsentFraction guards against a partial Requesty response disabling
// a large slice of the catalogue: if more than this share of enabled Requesty
// models is absent from the fetch, the disable pass is skipped unless forced.
const maxDisableAbsentFraction = 0.25

// Service enriches curated Requesty-provider models with fresh metadata.
type Service struct {
	app     core.App
	fetcher ModelsFetcher
	logger  *slog.Logger
}

func NewService(app core.App, fetcher ModelsFetcher, logger *slog.Logger) *Service {
	return &Service{app: app, fetcher: fetcher, logger: logger}
}

// Run fetches the Requesty catalogue and updates matched ai_models records.
// It refreshes derived fields (reasoning efforts, pricing, context, capability
// flags) and disables models that have vanished from Requesty (they stop
// working once removed). It never deletes records and never touches the other
// curation/compliance fields (whitelisted, privacy_tier, hosting_*, display
// name). Reasoning efforts are set only when absent, so manual overrides win.
// The disable pass is guarded against a partial/empty fetch (see
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

	var absentEnabled []*core.Record
	enabledCount := 0
	for _, record := range records {
		isEnabled := record.GetBool("enabled")
		if isEnabled {
			enabledCount++
		}

		model, ok := byID[NormalizeID(record.GetString("provider_model_id"))]
		if !ok {
			// Present in our catalogue but gone from Requesty — a disable
			// candidate (handled after the loop, behind the health guard).
			if isEnabled {
				absentEnabled = append(absentEnabled, record)
			}
			continue
		}
		summary.Matched++

		changed := false

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

	// Disable pass: models removed from Requesty stop working, so disable (never
	// delete) them. Guard against a partial/empty fetch wiping the catalogue —
	// skip unless the absent share is small or the caller forces it. An empty
	// fetch is never a valid removal signal, even when forced.
	if len(absentEnabled) > 0 {
		absentFraction := 1.0
		if enabledCount > 0 {
			absentFraction = float64(len(absentEnabled)) / float64(enabledCount)
		}
		healthyFetch := summary.Fetched > 0
		if healthyFetch && (opts.ForceDisableAbsent || absentFraction <= maxDisableAbsentFraction) {
			for _, record := range absentEnabled {
				record.Set("enabled", false)
				if err := s.app.Save(record); err != nil {
					if s.logger != nil {
						s.logger.Error("requesty sync: failed to disable absent model",
							"model_id", record.GetString("model_id"), "err", err)
					}
					continue
				}
				summary.Disabled++
			}
		} else {
			summary.DisableSkipped = true
			if s.logger != nil {
				s.logger.Warn("requesty sync: skipped disabling absent models",
					"absent", len(absentEnabled), "enabled", enabledCount,
					"absent_fraction", absentFraction, "fetched", summary.Fetched,
					"forced", opts.ForceDisableAbsent,
					"hint", "re-run with force to override the health guard")
			}
		}
	}

	if s.logger != nil {
		s.logger.Info("requesty model sync complete",
			"fetched", summary.Fetched, "matched", summary.Matched,
			"updated", summary.Updated, "reasoning_enabled", summary.ReasoningEnabled,
			"disabled", summary.Disabled, "disable_skipped", summary.DisableSkipped)
	}
	return summary, nil
}
