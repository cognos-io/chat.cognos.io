package catalogue

import "slices"

type PrivacyTier string

const (
	PrivacyTierCHOnly PrivacyTier = "ch_only"
	PrivacyTierEU     PrivacyTier = "eu"
	PrivacyTierGlobal PrivacyTier = "global"
)

type ContentType string

const (
	ContentTypeText ContentType = "text"
)

type Tag struct {
	Title string `json:"title"`
}

type Pricing struct {
	InputUSDPerMillionTokens  float64 `json:"input_usd_per_million_tokens"`
	OutputUSDPerMillionTokens float64 `json:"output_usd_per_million_tokens"`
}

type Model struct {
	ID                  string        `json:"id"`
	Name                string        `json:"name"`
	Slug                string        `json:"slug"`
	Description         string        `json:"description"`
	ProviderID          string        `json:"provider_id"`
	ProviderModelID     string        `json:"provider_model_id"`
	PrivacyTier         PrivacyTier   `json:"privacy_tier"`
	Tags                []Tag         `json:"tags,omitempty"`
	ContentTypes        []ContentType `json:"content_types"`
	InputContextTokens  int           `json:"input_context_tokens"`
	MaxOutputTokens     int           `json:"max_output_tokens,omitempty"`
	Pricing             Pricing       `json:"pricing"`
	RequiresNoRetention bool          `json:"-"`
	IsActive            bool          `json:"-"`
}

var allModels = []Model{
	{
		ID:              "llama-3-3-infomaniak",
		Name:            "Llama 3.3",
		Slug:            "llama-3-3-infomaniak",
		Description:     "Meta's Llama 3.3 model, hosted in Switzerland by Infomaniak with no data retention.",
		ProviderID:      "infomaniak",
		ProviderModelID: "llama-3.3-70b-instruct",
		PrivacyTier:     PrivacyTierCHOnly,
		Tags: []Tag{
			{Title: "general-purpose"},
			{Title: "switzerland"},
		},
		ContentTypes:       []ContentType{ContentTypeText},
		InputContextTokens: 128_000,
		MaxOutputTokens:    8_192,
		Pricing: Pricing{
			InputUSDPerMillionTokens:  1,
			OutputUSDPerMillionTokens: 2,
		},
		RequiresNoRetention: true,
		IsActive:            true,
	},
}

func AllModels() []Model {
	return slices.Clone(allModels)
}

func ActiveModels() []Model {
	models := make([]Model, 0, len(allModels))
	for _, model := range allModels {
		if !model.IsActive {
			continue
		}
		models = append(models, model)
	}
	return models
}

func GetModelByID(modelID string) (Model, bool) {
	for _, model := range allModels {
		if model.ID == modelID {
			return model, true
		}
	}
	return Model{}, false
}

func ModelsAvailableForTier(userTier PrivacyTier) []Model {
	models := make([]Model, 0, len(allModels))
	for _, model := range allModels {
		if !model.IsActive || !IsEligibleForTier(userTier, model.PrivacyTier) {
			continue
		}
		models = append(models, model)
	}
	return models
}

func IsEligibleForTier(userTier PrivacyTier, modelTier PrivacyTier) bool {
	return tierRank(modelTier) <= tierRank(userTier)
}

func NormalizePrivacyTier(raw string) PrivacyTier {
	switch PrivacyTier(raw) {
	case PrivacyTierCHOnly, PrivacyTierEU, PrivacyTierGlobal:
		return PrivacyTier(raw)
	default:
		return PrivacyTierEU
	}
}

func tierRank(tier PrivacyTier) int {
	switch tier {
	case PrivacyTierCHOnly:
		return 0
	case PrivacyTierEU:
		return 1
	case PrivacyTierGlobal:
		return 2
	default:
		return tierRank(PrivacyTierEU)
	}
}
