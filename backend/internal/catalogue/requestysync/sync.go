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
}

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
// It only ever writes derived fields (reasoning efforts, pricing, context) and
// never touches curation/compliance fields (enabled, whitelisted, privacy_tier,
// hosting_*). Reasoning efforts are set only when absent, so manual overrides
// win. It is idempotent and safe to run repeatedly.
func (s *Service) Run(ctx context.Context) (Summary, error) {
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

	for _, record := range records {
		model, ok := byID[NormalizeID(record.GetString("provider_model_id"))]
		if !ok {
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
			"supports_web_search":   model.SupportsWebSearch,
			"supports_computer_use": model.SupportsComputerUse,
		} {
			if record.GetBool(field) != want {
				record.Set(field, want)
				changed = true
			}
		}

		// Image generation is gated on a curated transport: we only advertise a
		// model as image-capable when Requesty reports it AND we know how to
		// route its image requests (images_api vs chat_completions). A newly
		// image-capable model stays off until an operator sets the transport,
		// then flips on automatically here — no broken routing in between.
		wantImage := imageGenerationEnabled(model, record.GetString("image_generation_transport"))
		if record.GetBool("supports_image_generation") != wantImage {
			record.Set("supports_image_generation", wantImage)
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

	if s.logger != nil {
		s.logger.Info("requesty model sync complete",
			"fetched", summary.Fetched, "matched", summary.Matched,
			"updated", summary.Updated, "reasoning_enabled", summary.ReasoningEnabled)
	}
	return summary, nil
}
