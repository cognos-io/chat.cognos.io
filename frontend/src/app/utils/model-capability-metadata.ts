// Curated, product-owned capability metadata keyed by the stable model id (the
// slug returned by /api/v1/models, e.g. "claude-opus-4-8"). These labels are
// subjective and MUST be curated by product — never inferred from a model's
// name or price (see docs/business_processes/model-capability-gating.md and the
// "fast/powerful are subjective" risk in). Unknown ids resolve to empty
// metadata so the catalogue can grow without code changes.
import { PrivacyTier } from '@app/interfaces/model';

// Purposes a model can be a recommended default for. Drives contextual default
// resolution (e.g. image tool active → prefer an image-capable recommendation).
export type ModelPurpose = 'chat' | 'image' | 'reasoning' | 'long_context';

export interface ModelCapabilityMetadata {
  // Surfaced under the "Recommended" filter and used as a default candidate.
  recommended: boolean;
  // Optional data-processing tiers where this recommendation applies. Empty
  // means every tier where the model is eligible.
  recommendedForPrivacyTiers: PrivacyTier[];
  // The purposes this model is a good recommended default for.
  recommendedDefaultFor: ModelPurpose[];
  // Curated speed/power signals. Not derivable from public metadata, so they
  // are explicit here rather than guessed.
  fast: boolean;
  powerful: boolean;
  // Language-neutral extra search terms (e.g. a product shorthand). Per-language
  // synonyms live in the i18n synonym layer, not here.
  aliases: string[];
}

export const EMPTY_MODEL_CAPABILITY_METADATA: ModelCapabilityMetadata = {
  recommended: false,
  recommendedForPrivacyTiers: [],
  recommendedDefaultFor: [],
  fast: false,
  powerful: false,
  aliases: [],
};

// Curated metadata keyed by model id (the slug from /api/v1/models). Entries are
// partial; missing fields fall back to EMPTY_MODEL_CAPABILITY_METADATA. This is
// PRODUCT-OWNED — review it whenever the catalogue changes. fast/powerful are
// curated judgements, never inferred from name or price.
//
// Seed decisions (2026-06): recommended default for EU/global users is
// gemini-3-5-flash; the Swiss (ch_only) recommended default is Qwen3.5 122B
// on Infomaniak; the image default is gemini-2-5-flash-image.
export const MODEL_CAPABILITY_METADATA: Readonly<
  Record<string, Partial<ModelCapabilityMetadata>>
> = {
  // --- recommended defaults -------------------------------------------------
  'gemini-3-5-flash': {
    recommended: true,
    recommendedForPrivacyTiers: ['eu', 'global'],
    recommendedDefaultFor: ['chat'],
    fast: true,
  },
  'moonshotai-kimi-k2-6-infomaniak': {
    recommended: true,
    recommendedForPrivacyTiers: ['ch_only'],
    recommendedDefaultFor: ['chat'],
  },
  'gemini-2-5-flash-image': {
    recommended: true,
    recommendedDefaultFor: ['image'],
    fast: true,
  },
  // --- other recommended all-rounders --------------------------------------
  'claude-sonnet-4-6': { recommended: true, powerful: true },
  'gpt-5-mini': { recommended: true, fast: true },
  // --- fast tier ------------------------------------------------------------
  'gpt-5-nano': { fast: true },
  'gpt-4o-mini': { fast: true },
  'responses-gpt-4-1-nano': { fast: true },
  'gemini-3-1-flash-lite': { fast: true },
  'claude-haiku-4-5': { fast: true },
  // --- powerful tier --------------------------------------------------------
  'claude-opus-4-8': { powerful: true },
  'gpt-5-5': { powerful: true },
  'responses-gpt-5-5': { powerful: true },
  'gemini-2-5-pro': { powerful: true },
  'qwen-qwen3-5-397b-a17b-fp8-infomaniak': { powerful: true },
};

// modelCapabilityMetadata resolves the full metadata for a model id, merging any
// curated entry over the empty defaults. Pure and total: an unknown id returns
// the empty defaults rather than throwing.
export function modelCapabilityMetadata(modelId: string): ModelCapabilityMetadata {
  const curated = MODEL_CAPABILITY_METADATA[modelId];
  if (!curated) {
    return EMPTY_MODEL_CAPABILITY_METADATA;
  }
  return { ...EMPTY_MODEL_CAPABILITY_METADATA, ...curated };
}
