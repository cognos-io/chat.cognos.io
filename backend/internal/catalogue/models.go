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
	Slug     string `json:"slug,omitempty"`
	Title    string `json:"title"`
	Category string `json:"category,omitempty"`
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
	ProviderName        string        `json:"provider_name,omitempty"`
	ProviderModelID     string        `json:"-"`
	PrivacyTier         PrivacyTier   `json:"privacy_tier"`
	Tags                []Tag         `json:"tags,omitempty"`
	ContentTypes        []ContentType `json:"content_types"`
	InputContextTokens  int           `json:"input_context_tokens"`
	MaxOutputTokens     int           `json:"max_output_tokens,omitempty"`
	Pricing             Pricing       `json:"pricing"`
	NoRetention         bool          `json:"no_retention"`
	IsOpenSource        bool          `json:"is_open_source"`
	HostingCountry      string        `json:"hosting_country,omitempty"`
	HostingRegion       string        `json:"hosting_region,omitempty"`
	ProviderDescription string        `json:"provider_description,omitempty"`
	// SupportsImageGeneration marks a model that can generate images. Distinct
	// from image input/vision support.
	SupportsImageGeneration bool `json:"supports_image_generation"`
	// ImageGenerationTransport is the provider API to use for image generation
	// ("images_api" or "chat_completions"). Backend routing only — not exposed to
	// the frontend. Only meaningful when SupportsImageGeneration is true.
	ImageGenerationTransport string `json:"-"`
	IsActive                 bool   `json:"-"`
}

func CloneModels(models []Model) []Model {
	return slices.Clone(models)
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
