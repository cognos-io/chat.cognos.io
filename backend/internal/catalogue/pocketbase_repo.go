package catalogue

import (
	"context"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type PocketBaseRepo struct {
	app core.App
}

func NewPocketBaseRepo(app core.App) *PocketBaseRepo {
	return &PocketBaseRepo{app: app}
}

type providerRecord struct {
	ProviderID   string
	Name         string
	Description  string
	RoutingID    string
	RecordID     string
	Enabled      bool
	IsOpenSource bool
}

type tagRecord struct {
	Slug     string
	Title    string
	Category string
}

func (r *PocketBaseRepo) ActiveModels(_ context.Context) ([]Model, error) {
	if r == nil || r.app == nil {
		return nil, nil
	}

	providers, err := r.activeProviders()
	if err != nil {
		return nil, err
	}

	tagsByID, err := r.tagsByID()
	if err != nil {
		return nil, err
	}

	records, err := r.app.FindAllRecords(
		"ai_models",
		dbx.HashExp{
			"enabled":     true,
			"whitelisted": true,
		},
	)
	if err != nil {
		return nil, err
	}

	models := make([]Model, 0, len(records))
	for _, record := range records {
		providerRecordID := strings.TrimSpace(record.GetString("provider"))
		if providerRecordID == "" {
			providerIDs := record.GetStringSlice("provider")
			if len(providerIDs) > 0 {
				providerRecordID = strings.TrimSpace(providerIDs[0])
			}
		}

		provider, ok := providers[providerRecordID]
		if !ok || !provider.Enabled {
			continue
		}

		modelID := strings.TrimSpace(record.GetString("model_id"))
		providerModelID := strings.TrimSpace(record.GetString("provider_model_id"))
		if modelID == "" || providerModelID == "" {
			continue
		}

		model := Model{
			ID:                  modelID,
			Name:                strings.TrimSpace(record.GetString("name")),
			Slug:                strings.TrimSpace(record.GetString("slug")),
			Description:         strings.TrimSpace(record.GetString("description")),
			ProviderID:          provider.ProviderID,
			ProviderName:        provider.Name,
			ProviderModelID:     providerModelID,
			PrivacyTier:         NormalizePrivacyTier(record.GetString("privacy_tier")),
			Tags:                mapTags(record.GetStringSlice("tags"), tagsByID),
			ContentTypes:        []ContentType{ContentTypeText},
			InputContextTokens:  record.GetInt("input_context_tokens"),
			MaxOutputTokens:     record.GetInt("max_output_tokens"),
			Pricing:             Pricing{InputUSDPerMillionTokens: record.GetFloat("input_usd_per_million_tokens"), OutputUSDPerMillionTokens: record.GetFloat("output_usd_per_million_tokens")},
			NoRetention:         record.GetBool("no_retention"),
			IsOpenSource:        record.GetBool("is_open_source"),
			HostingCountry:      strings.TrimSpace(record.GetString("hosting_country")),
			HostingRegion:       strings.TrimSpace(record.GetString("hosting_region")),
			ProviderDescription: provider.Description,

			SupportsImageGeneration:  record.GetBool("supports_image_generation"),
			ImageGenerationTransport: strings.TrimSpace(record.GetString("image_generation_transport")),
			ReasoningEfforts:         normaliseEfforts(record.GetStringSlice("reasoning_efforts")),
			DefaultReasoningEffort:   strings.TrimSpace(record.GetString("default_reasoning_effort")),
			SupportsVision:           record.GetBool("supports_vision"),
			SupportsFileInput:        record.GetBool("supports_file_input"),
			SupportsToolCalling:      record.GetBool("supports_tool_calling"),
			SupportsWebSearch:        record.GetBool("supports_web_search"),
			SupportsComputerUse:      record.GetBool("supports_computer_use"),
			EligibleForCompaction:    record.GetBool("eligible_for_compaction"),
			SupportsStructuredOutput: record.GetBool("supports_structured_output"),
			SupportsCacheHints:       record.GetBool("supports_cache_hints"),
			ApproxCharsPerToken:      record.GetInt("approx_chars_per_token"),
			IsActive:                 true,
		}

		if model.Name == "" {
			model.Name = model.ID
		}
		if model.Slug == "" {
			model.Slug = model.ID
		}

		models = append(models, model)
	}

	return models, nil
}

func (r *PocketBaseRepo) activeProviders() (map[string]providerRecord, error) {
	records, err := r.app.FindAllRecords(
		"ai_providers",
		dbx.HashExp{"enabled": true},
	)
	if err != nil {
		return nil, err
	}

	providers := make(map[string]providerRecord, len(records))
	for _, record := range records {
		providerID := strings.TrimSpace(record.GetString("provider_id"))
		if providerID == "" {
			continue
		}
		providers[record.Id] = providerRecord{
			RecordID:     record.Id,
			ProviderID:   providerID,
			Name:         strings.TrimSpace(record.GetString("name")),
			Description:  strings.TrimSpace(record.GetString("description")),
			RoutingID:    strings.TrimSpace(record.GetString("routing_provider_id")),
			Enabled:      record.GetBool("enabled"),
			IsOpenSource: record.GetBool("is_open_source"),
		}
		if providers[record.Id].Name == "" {
			provider := providers[record.Id]
			provider.Name = provider.ProviderID
			providers[record.Id] = provider
		}
	}

	return providers, nil
}

func (r *PocketBaseRepo) tagsByID() (map[string]tagRecord, error) {
	records, err := r.app.FindAllRecords("ai_tags")
	if err != nil {
		return nil, err
	}

	tagsByID := make(map[string]tagRecord, len(records))
	for _, record := range records {
		title := strings.TrimSpace(record.GetString("title"))
		if title == "" {
			continue
		}
		tagsByID[record.Id] = tagRecord{
			Slug:     strings.TrimSpace(record.GetString("slug")),
			Title:    title,
			Category: strings.TrimSpace(record.GetString("category")),
		}
	}

	return tagsByID, nil
}

func mapTags(ids []string, tagsByID map[string]tagRecord) []Tag {
	if len(ids) == 0 {
		return nil
	}

	tags := make([]Tag, 0, len(ids))
	for _, id := range ids {
		tag, ok := tagsByID[id]
		if !ok {
			continue
		}
		tags = append(tags, Tag{
			Slug:     tag.Slug,
			Title:    tag.Title,
			Category: tag.Category,
		})
	}

	return tags
}

// normaliseEfforts trims and drops blank entries from the stored reasoning
// effort list, preserving order. Returns nil for an empty list so the JSON
// field is omitted and no selector is shown.
func normaliseEfforts(raw []string) []string {
	efforts := make([]string, 0, len(raw))
	for _, effort := range raw {
		if trimmed := strings.TrimSpace(effort); trimmed != "" {
			efforts = append(efforts, trimmed)
		}
	}
	if len(efforts) == 0 {
		return nil
	}
	return efforts
}
