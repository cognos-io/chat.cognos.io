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
	// ReasoningEfforts is the ordered list of reasoning-effort tiers this model
	// accepts (e.g. ["off","low","medium","high"]). Empty means the model takes
	// no effort parameter, so the composer shows no effort selector for it.
	ReasoningEfforts []string `json:"reasoning_efforts,omitempty"`
	// DefaultReasoningEffort is the tier preselected in the composer. Only
	// meaningful when ReasoningEfforts is non-empty.
	DefaultReasoningEffort string `json:"default_reasoning_effort,omitempty"`
	// Capability flags kept fresh by the Requesty sync. Distinct from
	// SupportsImageGeneration, which stays curated (it drives image routing).
	SupportsVision      bool `json:"supports_vision"`
	SupportsToolCalling bool `json:"supports_tool_calling"`
	SupportsWebSearch   bool `json:"supports_web_search"`
	SupportsComputerUse bool `json:"supports_computer_use"`
	// Compaction capability metadata (spec docs/specs/client-side-compaction.md
	// §6.4). Compaction reads these capabilities and never branches on model IDs.
	// EligibleForCompaction gates whether the model may be used to compact at all.
	EligibleForCompaction bool `json:"eligible_for_compaction"`
	// SupportsStructuredOutput enables native JSON-schema / forced-tool output;
	// when false the compaction handler falls back to delimited-text parsing.
	SupportsStructuredOutput bool `json:"supports_structured_output"`
	// SupportsCacheHints means the provider accepts explicit cache_control
	// breakpoints; when false we rely on stable-prefix layout / auto-cache.
	SupportsCacheHints bool `json:"supports_cache_hints"`
	// ApproxCharsPerToken is a per-family heuristic for rough draft token
	// estimates. 0 means "use DefaultApproxCharsPerToken".
	ApproxCharsPerToken int  `json:"approx_chars_per_token"`
	IsActive            bool `json:"-"`
}

// DefaultApproxCharsPerToken is the fallback chars-per-token ratio used when a
// model does not declare its own. Deliberately conservative (lower ratio => more
// estimated tokens => compact a little earlier rather than overflow context).
const DefaultApproxCharsPerToken = 3

// CharsPerToken returns the model's declared chars-per-token heuristic, falling
// back to DefaultApproxCharsPerToken when unset.
func (m Model) CharsPerToken() int {
	if m.ApproxCharsPerToken > 0 {
		return m.ApproxCharsPerToken
	}
	return DefaultApproxCharsPerToken
}

// AcceptsReasoningEffort reports whether the given effort tier is one this model
// declares. Empty effort (no selection) is always accepted — it means "send no
// reasoning parameter".
func (m Model) AcceptsReasoningEffort(effort string) bool {
	if effort == "" {
		return true
	}
	return slices.Contains(m.ReasoningEfforts, effort)
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
